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
    const geminiModelRef = useRef<any | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingStartTimeRef = useRef<number>(0);
    const speakerNamesRef = useRef<Map<string, string>>(new Map());
    const isManuallyStopping = useRef(false);
    
    // Storage for segments
    const geminiSegmentsRef = useRef<LiveSegment[]>([]);
    const azureSegmentsRef = useRef<AzureSpeakerSegment[]>([]);
    const combinedTranscriptRef = useRef<CombinedSegment[]>([]);

    // Load Azure SDK - FIXED: Check for SpeechSDK global
    useEffect(() => {
        if ((window as any).SpeechSDK) {
            setIsSDKLoading(false);
            return;
        }

        if (document.getElementById(SCRIPT_ID)) {
            const interval = setInterval(() => {
                if ((window as any).SpeechSDK) {
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
        script.onload = () => {
            console.log("Azure Speech SDK loaded.");
            if ((window as any).SpeechSDK) {
                setIsSDKLoading(false);
            } else {
                setError("Azure Speech SDK loaded but global SpeechSDK not found.");
                setIsSDKLoading(false);
            }
        };
        script.onerror = () => {
            setError("Azure Speech SDK failed to load. Check your internet connection, disable ad-blockers, and refresh the page.");
            setIsSDKLoading(false);
        };
        document.body.appendChild(script);
    }, []);

    const cleanup = useCallback(() => {
        if (azureTranscriberRef.current) {
            azureTranscriberRef.current.close();
            azureTranscriberRef.current = null;
        }
        geminiModelRef.current = null;
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

    const getSpeakerName = useCallback((speakerId: string): string => {
        if (speakerNamesRef.current.has(speakerId)) {
            return speakerNamesRef.current.get(speakerId)!;
        }
        
        const count = speakerNamesRef.current.size;
        const name = `Speaker ${String.fromCharCode(65 + count)}`; // A, B, C...
        speakerNamesRef.current.set(speakerId, name);
        return name;
    }, []);

    // Analyze text from Azure transcription with Gemini
    const analyzeTextWithGemini = useCallback(async (text: string, timestamp: number) => {
        if (!geminiModelRef.current || !text || text.trim().length < 5) return;

        try {
            const model = geminiModelRef.current;
            
            // Analyze the transcript text
            const analysisResult = await model.generateContent([
                `Analyze this sales conversation text and provide ONLY a JSON object (no markdown, no code blocks):
{"emotion":"joy/calm/nervousness/anger/neutral","sentiment":"positive/neutral/negative","feedback":"brief coaching tip"}

Text: "${text}"`
            ]);

            let analysisText = analysisResult.response.text();
            
            // Strip markdown code blocks if present
            analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            try {
                const parsed = JSON.parse(analysisText);
                
                geminiSegmentsRef.current.push({
                    text: text,
                    emotion: parsed.emotion,
                    sentiment: parsed.sentiment,
                    timestamp: timestamp
                });

                if (parsed.feedback) {
                    setRealtimeFeedback(prev => [parsed.feedback, ...prev].slice(0, 5));
                }

                mergeSegments();
            } catch (e) {
                console.error('Failed to parse Gemini response:', e);
                console.log('Raw response:', analysisText);
                
                // Fallback: save text without analysis
                geminiSegmentsRef.current.push({
                    text: text,
                    emotion: undefined,
                    sentiment: undefined,
                    timestamp: timestamp
                });
                mergeSegments();
            }
        } catch (apiError) {
            console.error('Gemini API error:', apiError);
            // Continue without breaking the recording
        }
    }, [mergeSegments]);

    // Initialize Gemini model
    const initializeGeminiModel = useCallback(() => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            geminiModelRef.current = model;
            console.log('Gemini model initialized');
        } catch (error) {
            console.error('Gemini initialization error:', error);
            setError('Failed to initialize Gemini analysis');
        }
    }, []);

    // Start Azure Speaker Diarization - FIXED: Use SpeechSDK global
    const startAzureDiarization = useCallback(async () => {
        const sdk = (window as any).SpeechSDK;
        if (!sdk) {
            setError("Azure Speech SDK not loaded yet.");
            return;
        }

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
                    
                    // Send text to Gemini for emotion/sentiment analysis
                    analyzeTextWithGemini(e.result.text, currentTime);
                    
                    // Merge with Gemini data
                    mergeSegments();
                }
            };

            transcriber.sessionStopped = () => {
                console.log("Azure session stopped");
                if (!isManuallyStopping.current) {
                    stopRecording();
                }
            };

            transcriber.canceled = (_s: any, e: any) => {
                console.error(`Azure canceled: Reason=${e.reason}`);
                if (e.reason === sdk.CancellationReason.Error) {
                    console.error(`Azure ErrorCode=${e.errorCode}`);
                    console.error(`Azure ErrorDetails=${e.errorDetails}`);
                    setError(`Speech recognition error: ${e.errorDetails}. Please check your Azure credentials.`);
                }
                cleanup();
                setRecordingState(RecordingState.IDLE);
            };

            await transcriber.startTranscribingAsync();
        } catch (error) {
            console.error('Azure diarization error:', error);
            setError('Failed to start speaker identification. Please check your Azure credentials.');
        }
    }, [analyzeTextWithGemini, mergeSegments, getSpeakerName, cleanup]);

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

    // Analyze complete recording with Gemini
    const analyzeFullRecording = useCallback(async () => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            const fullTranscript = combinedTranscriptRef.current
                .map(seg => `[${seg.speaker}] ${seg.text}`)
                .join('\n');
            
            if (!fullTranscript || fullTranscript.trim().length < 50) {
                console.log('Transcript too short for full analysis, saving with basic data');
                await saveToFirebase('Recording completed. Transcript was too short for detailed analysis.');
                return;
            }
            
            try {
                const analysisResult = await model.generateContent([
                    `Analyze this complete sales conversation transcript and provide:
1. Overall sentiment analysis
2. Key emotional patterns and shifts
3. Communication strengths (what was done well)
4. Areas for improvement (missed opportunities)
5. Coaching recommendations
6. Talk-to-listen ratio assessment
7. Question quality evaluation
8. Objection handling review

Provide actionable insights for sales improvement.

Transcript:
${fullTranscript}`
                ]);

                const analysisText = analysisResult.response.text();
                await saveToFirebase(analysisText);
            } catch (apiError) {
                console.error('Gemini API error in full analysis:', apiError);
                await saveToFirebase('Recording completed. Full transcript available for review.');
            }

        } catch (error) {
            console.error('Full analysis error:', error);
            await saveToFirebase('Recording completed with partial data.');
        }
    }, []);

    const startRecording = async () => {
        if (isSDKLoading) {
            return;
        }

        isManuallyStopping.current = false;
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
            // Check microphone permission first
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Start MediaRecorder for full audio capture
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            // Collect chunks every 5 seconds
            mediaRecorder.start(5000);

            // Initialize Gemini and start Azure
            initializeGeminiModel();
            await startAzureDiarization();

        } catch (error) {
            console.error('Failed to start recording:', error);
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                setError('Microphone access was denied. Please enable microphone permissions in your browser settings and try again.');
            } else {
                setError('Could not access microphone or initialize services. Please check your internet connection and Azure credentials.');
            }
            setRecordingState(RecordingState.IDLE);
        }
    };

    const stopRecording = useCallback(async () => {
        isManuallyStopping.current = true;
        
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
        
        // Now analyze with Gemini
        await analyzeFullRecording();
    }, [mergeSegments, analyzeFullRecording]);

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
        isManuallyStopping.current = false;
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