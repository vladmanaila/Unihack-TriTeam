import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RecordingState } from '../types';
import { auth, db, storage } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const AZURE_KEY = import.meta.env.VITE_AZURE_SPEECH_KEY;
const AZURE_REGION = import.meta.env.VITE_AZURE_REGION;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const SCRIPT_ID = 'azure-speech-sdk-script';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.36.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle.js';

interface LiveSegment {
    text: string;
    emotion?: string;
    sentiment?: string;
    timestamp: number;
}

interface AzureSpeakerSegment {
    speakerId: string;
    text: string;
    start: number;
    end: number;
}

interface CombinedSegment {
    speaker: string;
    text: string;
    emotion?: string;
    sentiment?: string;
    start: number;
    end: number;
}

export const useSalesCoach = () => {
    const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
    const [transcript, setTranscript] = useState<string>('');
    const [realtimeFeedback, setRealtimeFeedback] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isSDKLoading, setIsSDKLoading] = useState(true);
    const [currentSpeaker, setCurrentSpeaker] = useState<string>('');

    // Refs for tracking
    const azureTranscriberRef = useRef<any | null>(null);
    const geminiSessionRef = useRef<any | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingStartTimeRef = useRef<number>(0);
    
    // Storage for segments
    const geminiSegmentsRef = useRef<LiveSegment[]>([]);
    const azureSegmentsRef = useRef<AzureSpeakerSegment[]>([]);
    const combinedTranscriptRef = useRef<CombinedSegment[]>([]);

    // Load Azure SDK
    useEffect(() => {
        if ((window as any).Microsoft?.CognitiveServices?.Speech) {
            setIsSDKLoading(false);
            return;
        }

        if (document.getElementById(SCRIPT_ID)) {
            const interval = setInterval(() => {
                if ((window as any).Microsoft?.CognitiveServices?.Speech) {
                    setIsSDKLoading(false);
                    clearInterval(interval);
                }
            }, 100);
            return () => clearInterval(interval);
        }

        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = SDK_URL;
        script.async = true;
        script.onload = () => setIsSDKLoading(false);
        script.onerror = () => {
            setError("Azure Speech SDK failed to load");
            setIsSDKLoading(false);
        };
        document.body.appendChild(script);
    }, []);

    const cleanup = useCallback(() => {
        if (azureTranscriberRef.current) {
            azureTranscriberRef.current.close();
            azureTranscriberRef.current = null;
        }
        if (geminiSessionRef.current) {
            geminiSessionRef.current.close?.();
            geminiSessionRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    }, []);

    // Merge Gemini + Azure segments by timestamp
    const mergeSegments = useCallback(() => {
        const combined: CombinedSegment[] = [];
        
        azureSegmentsRef.current.forEach(azureSegment => {
            // Find matching Gemini segment by timestamp overlap
            const matchingGemini = geminiSegmentsRef.current.find(geminiSeg => 
                Math.abs(geminiSeg.timestamp - azureSegment.start) < 2 // 2 second tolerance
            );
            
            combined.push({
                speaker: azureSegment.speakerId,
                text: azureSegment.text,
                emotion: matchingGemini?.emotion,
                sentiment: matchingGemini?.sentiment,
                start: azureSegment.start,
                end: azureSegment.end
            });
        });
        
        combinedTranscriptRef.current = combined;
        
        // Update display transcript
        const displayText = combined
            .map(seg => `[${seg.speaker}] ${seg.text} ${seg.emotion ? `(${seg.emotion})` : ''}`)
            .join('\n');
        setTranscript(displayText);
    }, []);

    // Start Gemini Live Audio Session
    const startGeminiLiveSession = async () => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            geminiSessionRef.current = model;
            
            console.log('Gemini session ready');
        } catch (error) {
            console.error('Gemini Live session error:', error);
            setError('Failed to start Gemini analysis');
        }
    };

    // Start Azure Speaker Diarization
    const startAzureDiarization = async () => {
        const sdk = (window as any).Microsoft?.CognitiveServices?.Speech;
        if (!sdk) return;

        try {
            const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_KEY, AZURE_REGION);
            speechConfig.speechRecognitionLanguage = "en-US";
            
            const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
            const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
            azureTranscriberRef.current = transcriber;

            transcriber.transcribed = (_s: any, e: any) => {
                if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
                    const speakerId = e.result.speakerId || 'Unknown';
                    const currentTime = (Date.now() - recordingStartTimeRef.current) / 1000;
                    const duration = e.result.duration / 10000000; // Convert ticks to seconds
                    
                    const segment: AzureSpeakerSegment = {
                        speakerId: getSpeakerName(speakerId),
                        text: e.result.text,
                        start: currentTime - duration,
                        end: currentTime
                    };
                    
                    azureSegmentsRef.current.push(segment);
                    setCurrentSpeaker(segment.speakerId);
                    
                    // Merge with Gemini data
                    mergeSegments();
                }
            };

            transcriber.sessionStopped = () => {
                console.log("Azure session stopped");
            };

            transcriber.canceled = (_s: any, e: any) => {
                console.error(`Azure canceled: ${e.reason}`);
                if (e.reason === sdk.CancellationReason.Error) {
                    setError(`Azure error: ${e.errorDetails}`);
                }
            };

            await transcriber.startTranscribingAsync();
        } catch (error) {
            console.error('Azure diarization error:', error);
            setError('Failed to start speaker identification');
        }
    };

    const speakerNamesRef = useRef<Map<string, string>>(new Map());
    
    const getSpeakerName = (speakerId: string): string => {
        if (speakerNamesRef.current.has(speakerId)) {
            return speakerNamesRef.current.get(speakerId)!;
        }
        
        const count = speakerNamesRef.current.size;
        const name = `Speaker ${String.fromCharCode(65 + count)}`; // A, B, C...
        speakerNamesRef.current.set(speakerId, name);
        return name;
    };

    // Send audio chunks to Gemini
    const sendAudioToGemini = useCallback(async (audioBlob: Blob) => {
        if (!geminiSessionRef.current) return;

        try {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            
            reader.onloadend = async () => {
                const base64Audio = (reader.result as string).split(',')[1];
                
                const model = geminiSessionRef.current;
                const result = await model.generateContent({
  prompt: {
    text: `Analyze this audio segment and provide:
1. Transcribed text
2. Detected emotion (joy, confidence, calm, anger, sadness, nervousness, enthusiasm, boredom)
3. Sentiment (positive, neutral, negative)
4. Brief coaching feedback

Format as JSON: {"text":"...","emotion":"...","sentiment":"...","feedback":"..."}`
  },
  multimodalInputs: [
    {
      mimeType: 'audio/webm',
      data: base64Audio
    }
  ]
});

                
                const text = result.response.text();
                try {
                    const parsed = JSON.parse(text);
                    const currentTime = (Date.now() - recordingStartTimeRef.current) / 1000;
                    
                    geminiSegmentsRef.current.push({
                        text: parsed.text,
                        emotion: parsed.emotion,
                        sentiment: parsed.sentiment,
                        timestamp: currentTime
                    });

                    if (parsed.feedback) {
                        setRealtimeFeedback(prev => [parsed.feedback, ...prev].slice(0, 5));
                    }

                    mergeSegments();
                } catch (e) {
                    console.error('Failed to parse Gemini response', e);
                }
            };
        } catch (error) {
            console.error('Error sending audio to Gemini:', error);
        }
    }, [mergeSegments]);

    const startRecording = async () => {
        if (isSDKLoading) return;

        setRecordingState(RecordingState.RECORDING);
        setTranscript('');
        setRealtimeFeedback([]);
        setError(null);
        geminiSegmentsRef.current = [];
        azureSegmentsRef.current = [];
        combinedTranscriptRef.current = [];
        audioChunksRef.current = [];
        speakerNamesRef.current.clear();
        recordingStartTimeRef.current = Date.now();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Start MediaRecorder for full audio capture
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                    
                    // Send chunk to Gemini
                    await sendAudioToGemini(event.data);
                }
            };

            // Collect chunks every 3 seconds for Gemini
            mediaRecorder.start(3000);

            // Start both services
            await Promise.all([
                startGeminiLiveSession(),
                startAzureDiarization()
            ]);

        } catch (error) {
            console.error('Failed to start recording:', error);
            setError('Could not access microphone');
            setRecordingState(RecordingState.IDLE);
        }
    };

    const stopRecording = useCallback(async () => {
        if (azureTranscriberRef.current) {
            await azureTranscriberRef.current.stopTranscribingAsync();
        }
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        
        setRecordingState(RecordingState.ANALYZING);
        
        // Wait a bit for final segments
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Final merge
        mergeSegments();
        
        // Now analyze with Gemini Pro (full audio)
        await analyzeFullRecording();
    }, [mergeSegments]);

    // Analyze complete recording with Gemini Pro
    const analyzeFullRecording = async () => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            const fullAudioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            
            const reader = new FileReader();
            reader.readAsDataURL(fullAudioBlob);
            
            reader.onloadend = async () => {
                const base64Audio = (reader.result as string).split(',')[1];
                
                const result = await model.generateContent([
                    { 
                        inlineData: {
                            mimeType: 'audio/webm',
                            data: base64Audio
                        }
                    },
                    `Analyze this complete sales conversation audio and provide:
1. Overall sentiment analysis
2. Key emotional patterns and shifts
3. Communication strengths (what went well)
4. Areas for improvement (missed opportunities)
5. Specific coaching recommendations
6. Talk-to-listen ratio assessment
7. Question quality analysis
8. Objection handling evaluation

Provide actionable insights for sales improvement.`
                ]);

                const analysisText = result.response.text();
                await saveToFirebase(analysisText);
            };

        } catch (error) {
            console.error('Full analysis error:', error);
            setError('Failed to analyze recording');
        }
    };

    const saveToFirebase = async (geminiAnalysis: string) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");

            // Upload audio
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const timestamp = Date.now();
            const storageRef = ref(storage, `recordings/${user.uid}/${timestamp}.webm`);
            await uploadBytes(storageRef, audioBlob);
            const audioUrl = await getDownloadURL(storageRef);

            // Calculate metrics
            const metrics = calculateMetrics();
            const coachingCards = generateCoachingCards(geminiAnalysis);

            // Save to Firestore
            await addDoc(collection(db, "recordings"), {
                title: `Sales Call - ${new Date().toLocaleDateString()}`,
                audioFileUrl: audioUrl,
                transcript: combinedTranscriptRef.current.map(s => `[${s.speaker}] ${s.text}`),
                transcriptSegments: JSON.stringify(combinedTranscriptRef.current),
                sentimentGraph: JSON.stringify(generateSentimentGraph()),
                coachingCard: coachingCards,
                geminiFullAnalysis: geminiAnalysis,
                recordingStats: metrics,
                speakers: JSON.stringify(Array.from(speakerNamesRef.current.entries())),
                userId: user.uid,
                date: serverTimestamp(),
                duration: formatDuration()
            });

            setRecordingState(RecordingState.DONE);
            alert('Recording saved successfully!');

        } catch (error) {
            console.error('Save error:', error);
            setError('Failed to save recording');
        }
    };

    const calculateMetrics = () => {
        const speakerTime = new Map<string, number>();
        let questionCount = 0;
        let totalSentimentScore = 0;
        let sentimentCount = 0;

        combinedTranscriptRef.current.forEach(seg => {
            speakerTime.set(
                seg.speaker,
                (speakerTime.get(seg.speaker) || 0) + (seg.end - seg.start)
            );

            if (seg.text.includes('?')) questionCount++;

            if (seg.sentiment === 'positive') {
                totalSentimentScore += 80;
                sentimentCount++;
            } else if (seg.sentiment === 'neutral') {
                totalSentimentScore += 60;
                sentimentCount++;
            } else if (seg.sentiment === 'negative') {
                totalSentimentScore += 40;
                sentimentCount++;
            }
        });

        const speakers = Array.from(speakerTime.entries());
        const totalTime = Array.from(speakerTime.values()).reduce((a, b) => a + b, 0);
        
        let talkRatio = "N/A";
        if (speakers.length >= 2) {
            const ratio1 = Math.round((speakers[0][1] / totalTime) * 100);
            const ratio2 = Math.round((speakers[1][1] / totalTime) * 100);
            talkRatio = `${ratio1}:${ratio2}`;
        }

        return {
            talkToListenRatio: talkRatio,
            questionCount: String(questionCount),
            sentimentScoreAvg: String(Math.round(totalSentimentScore / sentimentCount) || 0),
            engagementPercentage: "75",
            strengthsCount: "3",
            missedOpportunitiesCount: "2",
            fillerWordsCount: "0",
            keywordsDetected: JSON.stringify({}),
            competitorMentions: JSON.stringify({}),
            objectionsDetected: JSON.stringify([])
        };
    };

    const generateCoachingCards = (analysis: string): string[] => {
        // Parse Gemini analysis to extract strengths and opportunities
        const cards: string[] = [];
        
        if (analysis.includes('strength') || analysis.includes('well')) {
            const strengthMatch = analysis.match(/strength[s]?:(.+?)(?=improvement|$)/is);
            if (strengthMatch) {
                cards.push(`STRENGTH: ${strengthMatch[1].trim().substring(0, 100)}`);
            }
        }

        if (analysis.includes('improvement') || analysis.includes('opportunity')) {
            const opportunityMatch = analysis.match(/improvement[s]?:(.+?)(?=recommendation|$)/is);
            if (opportunityMatch) {
                cards.push(`OPPORTUNITY: ${opportunityMatch[1].trim().substring(0, 100)}`);
            }
        }

        return cards.length > 0 ? cards : ['STRENGTH: Call completed successfully'];
    };

    const generateSentimentGraph = () => {
        const points = [];
        for (let i = 0; i < combinedTranscriptRef.current.length; i += 3) {
            const seg = combinedTranscriptRef.current[i];
            if (seg) {
                const score = seg.sentiment === 'positive' ? 80 : seg.sentiment === 'neutral' ? 60 : 40;
                points.push({
                    time: formatTime(seg.start),
                    sentiment: score
                });
            }
        }
        return points;
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDuration = (): string => {
        if (combinedTranscriptRef.current.length === 0) return "0:00";
        const last = combinedTranscriptRef.current[combinedTranscriptRef.current.length - 1];
        return formatTime(last.end);
    };

    const reset = () => {
        cleanup();
        setRecordingState(RecordingState.IDLE);
        setTranscript('');
        setRealtimeFeedback([]);
        setError(null);
        geminiSegmentsRef.current = [];
        azureSegmentsRef.current = [];
        combinedTranscriptRef.current = [];
        audioChunksRef.current = [];
        speakerNamesRef.current.clear();
    };

    useEffect(() => {
        return () => cleanup();
    }, [cleanup]);

    return {
        recordingState,
        transcript,
        realtimeFeedback,
        error,
        isSDKLoading,
        currentSpeaker,
        combinedSegments: combinedTranscriptRef.current,
        startRecording,
        stopRecording,
        reset
    };
};