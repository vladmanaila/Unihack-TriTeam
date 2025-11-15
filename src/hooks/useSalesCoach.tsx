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

    

    // Load Azure SDK
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
            const matchingGemini = geminiSegmentsRef.current.find(geminiSeg => 
                Math.abs(geminiSeg.timestamp - azureSegment.start) < 2
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
        const name = `Speaker ${String.fromCharCode(65 + count)}`;
        speakerNamesRef.current.set(speakerId, name);
        return name;
    }, []);

    // Analyze text from Azure transcription with Gemini
    const analyzeTextWithGemini = useCallback(async (text: string, timestamp: number) => {
        if (!geminiModelRef.current || !text || text.trim().length < 5) return;

        try {
            const model = geminiModelRef.current;
            
           const analysisResult = await model.generateContent([
  `Analyze this sales conversation text and provide ONLY a JSON object:
{
  "emotion": "joy/calm/nervousness/anger/neutral",
  "sentiment": "positive/neutral/negative", 
  "feedback": "Specific, actionable 8-12 word coaching tip about sales technique, questioning, or customer engagement"
}

Text: "${text}"`
]);

            let analysisText = analysisResult.response.text();
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

   // Improved Azure configuration for better speaker detection
const startAzureDiarization = useCallback(async () => {
    const sdk = (window as any).SpeechSDK;
    if (!sdk) {
        setError("Azure Speech SDK not loaded yet.");
        return;
    }

    try {
        // Create speech config with optimizations
        const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_KEY, AZURE_REGION);
        speechConfig.speechRecognitionLanguage = "en-US";
        
        // CRITICAL: Enable conversation transcription mode
        speechConfig.setProperty(
            sdk.PropertyId.SpeechServiceConnection_EnableAudioLogging, 
            "false"
        );
        
        // Better audio processing
        speechConfig.setProperty(
            sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
            "10000"  // 10 seconds of silence before timeout
        );
        
        speechConfig.setProperty(
            sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
            "2000"  // 2 seconds of silence to end utterance
        );
        
        // Request higher quality audio processing
        const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
        
        // IMPORTANT: Use ConversationTranscriber with proper configuration
        const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
        azureTranscriberRef.current = transcriber;
        
        // Track speaker consistency
        const speakerUtterances = new Map<string, string[]>();
        
        transcriber.transcribed = (_s: any, e: any) => {
            if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
                const rawSpeakerId = e.result.speakerId || 'Unknown';
                const currentTime = (Date.now() - recordingStartTimeRef.current) / 1000;
                const duration = e.result.duration / 10000000;
                
                // Track what each speaker says
                if (!speakerUtterances.has(rawSpeakerId)) {
                    speakerUtterances.set(rawSpeakerId, []);
                }
                speakerUtterances.get(rawSpeakerId)!.push(e.result.text);
                
                // Log speaker patterns
                console.log(`🎤 ${rawSpeakerId}: "${e.result.text}"`);
                
                const segment: AzureSpeakerSegment = {
                    speakerId: rawSpeakerId,  // Keep raw ID for now
                    text: e.result.text,
                    start: currentTime - duration,
                    end: currentTime
                };
                
                azureSegmentsRef.current.push(segment);
                analyzeTextWithGemini(e.result.text, currentTime);
                mergeSegments();
            }
        };

        transcriber.sessionStopped = () => {
            console.log("Azure session stopped");
            console.log("Speaker patterns:", Array.from(speakerUtterances.entries()));
            if (!isManuallyStopping.current) {
                stopRecording();
            }
        };

        transcriber.canceled = (_s: any, e: any) => {
            console.error(`Azure canceled: Reason=${e.reason}`);
            if (e.reason === sdk.CancellationReason.Error) {
                console.error(`Azure ErrorCode=${e.errorCode}`);
                console.error(`Azure ErrorDetails=${e.errorDetails}`);
                setError(`Speech recognition error: ${e.errorDetails}`);
            }
            cleanup();
            setRecordingState(RecordingState.IDLE);
        };

        await transcriber.startTranscribingAsync();
        console.log("✓ Azure diarization started with optimized settings");
        
    } catch (error) {
        console.error('Azure diarization error:', error);
        setError('Failed to start speaker identification.');
    }
}, [analyzeTextWithGemini, mergeSegments, cleanup]);

// Better microphone configuration
const startRecordingOptimized = useCallback(async () => {
    try {
        setRecordingState(RecordingState.RECORDING);
        setError(null);
        
        geminiSegmentsRef.current = [];
        azureSegmentsRef.current = [];
        combinedTranscriptRef.current = [];
        audioChunksRef.current = [];
        speakerNamesRef.current.clear();
        
        recordingStartTimeRef.current = Date.now();
        initializeGeminiModel();
        
        // Request high-quality audio with specific constraints
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,  // 16kHz is optimal for speech
                channelCount: 1      // Mono audio
            } 
        });
        
        const mediaRecorder = new MediaRecorder(stream, { 
            mimeType: 'audio/webm',
            audioBitsPerSecond: 128000  // Good quality
        });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
            }
        };
        
        mediaRecorder.start(1000);
        await startAzureDiarization();
        
        console.log("✓ Recording started with optimized audio settings");
        
    } catch (error) {
        console.error('Start recording error:', error);
        setError('Failed to start recording. Please check microphone permissions.');
        setRecordingState(RecordingState.IDLE);
    }
}, [initializeGeminiModel, startAzureDiarization]);

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
        let totalWords = 0;
        let totalSentimentScore = 0;
        let sentimentCount = 0;

        combinedTranscriptRef.current.forEach(seg => {
            const segmentDuration = seg.end - seg.start;
            speakerTime.set(
                seg.speaker,
                (speakerTime.get(seg.speaker) || 0) + segmentDuration
            );

            totalWords += seg.text.split(/\s+/).filter(word => word.length > 0).length;

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

        let talkRatio = "50:50";
        const speakers = Array.from(speakerTime.entries());
        
        if (speakers.length >= 2) {
            const totalTime = speakers.reduce((sum, [, time]) => sum + time, 0);
            if (totalTime > 0) {
                const salesPersonTime = speakers[0][1];
                const customerTime = speakers[1][1];
                
                const salesRatio = Math.round((salesPersonTime / totalTime) * 100);
                const customerRatio = Math.round((customerTime / totalTime) * 100);
                talkRatio = `${salesRatio}:${customerRatio}`;
            }
        }

        const totalDuration = combinedTranscriptRef.current.length > 0 
            ? combinedTranscriptRef.current[combinedTranscriptRef.current.length - 1].end 
            : 60;
            
        const wordsPerMinute = (totalWords / totalDuration) * 60;
        
        let engagement = 50;

if (wordsPerMinute > 0) {
    // Normalize WPM into a 0–1 range between 80 and 200 WPM
    const minWpm = 80;
    const maxWpm = 200;

    const normalized = Math.min(
        1,
        Math.max(0, (wordsPerMinute - minWpm) / (maxWpm - minWpm))
    );

    // Engagement goes from 20 to 95
    engagement = Math.round(20 + normalized * 75);
}

        const avgSentiment = sentimentCount > 0 
            ? Math.round(totalSentimentScore / sentimentCount)
            : 50;

        return {
            talkToListenRatio: talkRatio,
            sentimentScoreAvg: String(avgSentiment),
            engagementPercentage: String(engagement),
            questionCount: "0",
            strengthsCount: "0", 
            missedOpportunitiesCount: "0",
            fillerWordsCount: "0",
            keywordsDetected: JSON.stringify({}),
            competitorMentions: JSON.stringify({}),
            objectionsDetected: JSON.stringify([])
        };
    };

    const generateSentimentGraph = () => {
        const points = [];
        let cumulativeSentiment = 0;
        let segmentCount = 0;

        points.push({ time: "0:00", sentiment: 50 });

        for (let i = 0; i < combinedTranscriptRef.current.length; i++) {
            const seg = combinedTranscriptRef.current[i];
            
            if (seg.sentiment) {
                const score = seg.sentiment === 'positive' ? 80 : 
                             seg.sentiment === 'neutral' ? 60 : 40;
                
                cumulativeSentiment += score;
                segmentCount++;

                if (i % 2 === 0 || points.length === 1) {
                    const currentAvg = Math.round(cumulativeSentiment / segmentCount);
                    const lastPoint = points[points.length - 1];
                    
                    if (points.length === 1 || Math.abs(currentAvg - lastPoint.sentiment) > 10) {
                        points.push({
                            time: formatTime(seg.start),
                            sentiment: currentAvg
                        });
                    }
                }
            }
        }

        return points;
    };

    // NEW: Correct speaker identification using context
    const correctSpeakerIdentification = useCallback(async (segments: CombinedSegment[]): Promise<CombinedSegment[]> => {
        if (segments.length === 0) return segments;
        
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            const conversationText = segments
                .map((seg, idx) => `${idx}|${seg.speaker}|${seg.text}`)
                .join('\n');
            
            const prompt = `You are a conversation analysis AI specializing in sales call transcription correction.

CRITICAL TASK: Fix speaker identification errors in this sales conversation.

RULES FOR SPEAKER IDENTIFICATION:
1. **Salesperson behaviors:**
   - Presents products/features ("I want to sell", "This product has", "We offer")
   - Asks discovery questions ("What do you need?", "Do you have?")
   - Handles objections and pushes forward
   
2. **Customer behaviors:**
   - Responds to questions ("I'm good", "I have many laptops")
   - Asks about products ("What product?", "Why?")
   - Makes decisions ("I don't need", "I need to find somebody else")

3. **CRITICAL - SPLIT MIXED SEGMENTS:**
   Look for segments where BOTH speakers are talking:
   - Question + Answer in same segment → MUST SPLIT
   - Statement + Question in same segment → MUST SPLIT
   - Any conversation turn that changes topic/direction → MUST SPLIT
   - When you see "What product? It is a laptop." → These are 2 different speakers!

EXAMPLES OF WHAT TO SPLIT:
❌ BAD: "What product? It is a laptop." (Question + Answer = 2 speakers!)
✅ GOOD: Split into → "What product?" | "It is a laptop."

❌ BAD: "I want to sell your product. What product?" (Statement + Question from different context)
✅ GOOD: Split into → "I want to sell your product." | "What product?"

RETURN FORMAT:
{
  "corrections": [
    {"index": 0, "correctedSpeaker": "Salesperson"}
  ],
  "splits": [
    {
      "originalIndex": 2,
      "segments": [
        {"speaker": "Customer", "text": "What product?"},
        {"speaker": "Salesperson", "text": "It is a laptop."}
      ]
    }
  ]
}

**Be VERY aggressive with splitting** - when in doubt, split it!

Conversation:
${conversationText}

Return ONLY valid JSON, no markdown:`;

            const result = await model.generateContent([prompt]);
            let responseText = result.response.text();
            responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            try {
                const response = JSON.parse(responseText) as {
                    corrections: Array<{index: number, correctedSpeaker: string}>,
                    splits: Array<{originalIndex: number, segments: Array<{speaker: string, text: string}>}>
                };
                
                let correctedSegments = [...segments];
                
                // First, apply splits (from end to beginning to maintain indices)
                if (response.splits && response.splits.length > 0) {
                    response.splits.sort((a, b) => b.originalIndex - a.originalIndex).forEach(split => {
                        const originalSeg = correctedSegments[split.originalIndex];
                        const duration = originalSeg.end - originalSeg.start;
                        const timePerSegment = duration / split.segments.length;
                        
                        const newSegments = split.segments.map((seg, i) => ({
                            speaker: seg.speaker,
                            text: seg.text,
                            emotion: originalSeg.emotion,
                            sentiment: originalSeg.sentiment,
                            start: originalSeg.start + (i * timePerSegment),
                            end: originalSeg.start + ((i + 1) * timePerSegment)
                        }));
                        
                        // Replace original segment with split segments
                        correctedSegments.splice(split.originalIndex, 1, ...newSegments);
                        console.log(`Split segment ${split.originalIndex} into ${split.segments.length} parts`);
                    });
                }
                
                // Then apply corrections
                if (response.corrections && response.corrections.length > 0) {
                    correctedSegments = correctedSegments.map((seg, idx) => {
                        const correction = response.corrections.find(c => c.index === idx);
                        if (correction) {
                            console.log(`Correcting segment ${idx}: ${seg.speaker} -> ${correction.correctedSpeaker}`);
                            return {
                                ...seg,
                                speaker: correction.correctedSpeaker
                            };
                        }
                        return seg;
                    });
                }
                
                // Finally, map any remaining Speaker A/B to roles
                const speakerMapping = new Map<string, string>();
                correctedSegments.forEach(seg => {
                    if (seg.speaker === 'Salesperson' || seg.speaker === 'Customer') {
                        // Already corrected
                    } else if (!speakerMapping.has(seg.speaker)) {
                        const isLikelySalesperson = 
                            seg.text.toLowerCase().includes('can i') ||
                            seg.text.toLowerCase().includes('let me') ||
                            seg.text.toLowerCase().includes('our product') ||
                            seg.text.toLowerCase().includes('we offer') ||
                            seg.text.toLowerCase().includes('would you') ||
                            seg.text.toLowerCase().includes('tell me about');
                        
                        speakerMapping.set(
                            seg.speaker, 
                            isLikelySalesperson ? 'Salesperson' : 'Customer'
                        );
                    }
                });
                
                return correctedSegments.map(seg => {
                    if (seg.speaker === 'Salesperson' || seg.speaker === 'Customer') {
                        return seg;
                    }
                    return {
                        ...seg,
                        speaker: speakerMapping.get(seg.speaker) || seg.speaker
                    };
                });
                
            } catch (parseError) {
                console.error('Failed to parse speaker corrections:', parseError);
                return segments;
            }
            
        } catch (error) {
            console.error('Speaker correction error:', error);
            return segments;
        }
    }, []);

    // Save to Firebase
    const saveToFirebase = async (
        geminiAnalysis: string,
        coachingCards: string[],
        strengths: string[],
        opportunities: string[],
        competitors: string[],
        keywords: { [key: string]: number },
        questions: string[]
    ) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");

            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const timestamp = Date.now();
            const storageRef = ref(storage, `recordings/${user.uid}/${timestamp}.webm`);
            await uploadBytes(storageRef, audioBlob);
            const audioUrl = await getDownloadURL(storageRef);

            const metrics = calculateMetrics();
            metrics.strengthsCount = String(strengths.length);
            metrics.missedOpportunitiesCount = String(opportunities.length);

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            const truncateLongText = (text: string, maxLength: number = 500): string => {
                if (text.length <= maxLength) return text;
                return text.substring(0, maxLength - 3) + '...';
            };

            await addDoc(collection(db, "recordings"), {
                title: `Sales Call - ${dateStr} at ${timeStr}`,
                audioFileUrl: audioUrl,
                transcript: combinedTranscriptRef.current.map(s => `[${s.speaker}] ${s.text}`),
                transcriptSegments: JSON.stringify(combinedTranscriptRef.current),
                sentimentGraph: JSON.stringify(generateSentimentGraph()),
                coachingCard: coachingCards.length > 0 ? coachingCards : ['STRENGTH: Call completed successfully'],
                strengths: (strengths || []).map(s => truncateLongText(s)),
                opportunities: (opportunities || []).map(o => truncateLongText(o)),
                competitors: competitors,
                keywords: keywords,
                questions: questions,
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

    // Extract all questions from transcript
    const extractAllQuestions = useCallback((segments: CombinedSegment[]): string[] => {
        const questions: string[] = [];
        
        segments.forEach(seg => {
            // Check if text contains a question mark
            if (seg.text.includes('?')) {
                // Split by periods and question marks to get individual sentences
                const sentences = seg.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
                
                sentences.forEach(sentence => {
                    // Check if this specific sentence is a question
                    if (seg.text.includes(sentence + '?') || 
                        sentence.toLowerCase().startsWith('what') ||
                        sentence.toLowerCase().startsWith('how') ||
                        sentence.toLowerCase().startsWith('why') ||
                        sentence.toLowerCase().startsWith('when') ||
                        sentence.toLowerCase().startsWith('where') ||
                        sentence.toLowerCase().startsWith('who') ||
                        sentence.toLowerCase().startsWith('which') ||
                        sentence.toLowerCase().startsWith('can') ||
                        sentence.toLowerCase().startsWith('could') ||
                        sentence.toLowerCase().startsWith('would') ||
                        sentence.toLowerCase().startsWith('should') ||
                        sentence.toLowerCase().startsWith('do you') ||
                        sentence.toLowerCase().startsWith('are you') ||
                        sentence.toLowerCase().startsWith('is it') ||
                        sentence.toLowerCase().startsWith('have you')) {
                        questions.push(`[${seg.speaker}] ${sentence}?`);
                    }
                });
            }
        });
        
        return questions;
    }, []);

    // Extract keywords and their frequency from transcript using NLP approach
    const extractKeywords = useCallback((segments: CombinedSegment[]): { [key: string]: number } => {
        const keywords: { [key: string]: number } = {};
        
        // Stop words to ignore (common words that aren't meaningful)
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'i', 'you', 'he', 'she',
            'it', 'we', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
            'am', 'yes', 'no', 'not', 'so', 'if', 'than', 'as', 'my', 'your',
            'our', 'me', 'him', 'her', 'us', 'what', 'when', 'where', 'who',
            'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
            'some', 'such', 'any', 'very', 'just', 'about', 'up', 'out', 'down',
            'there', 'here', 'now', 'then', 'well', 'also', 'too', 'only', 'even',
            'want', 'need', 'think', 'know', 'get', 'got', 'going', 'go', 'like',
            'really', 'yeah', 'okay', 'ok', 'um', 'uh', 'right'
        ]);
        
        const fullText = segments
            .map(seg => seg.text)
            .join(' ');
        
        // Extract all words (2+ characters, alphanumeric)
        const words = fullText
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .split(/\s+/)
            .filter(word => 
                word.length >= 2 && 
                !stopWords.has(word) &&
                !/^\d+$/.test(word) // Exclude pure numbers
            );
        
        // Count word frequency
        words.forEach(word => {
            keywords[word] = (keywords[word] || 0) + 1;
        });
        
        // Filter out words mentioned only once (likely not important)
        // and sort by frequency
        const sortedKeywords = Object.entries(keywords)
            .filter(([, count]) => count >= 2) // Keep only words mentioned 2+ times
            .sort(([, a], [, b]) => b - a)
            .slice(0, 30) // Keep top 30 keywords
            .reduce((obj, [key, value]) => {
                obj[key] = value;
                return obj;
            }, {} as { [key: string]: number });
        
        console.log('Extracted keywords from conversation:', sortedKeywords);
        return sortedKeywords;
    }, []);

    // Analyze full recording
    const analyzeFullRecording = useCallback(async () => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            const fullTranscript = combinedTranscriptRef.current
                .map(seg => `[${seg.speaker}] ${seg.text}`)
                .join('\n');
            
            if (!fullTranscript || fullTranscript.trim().length < 50) {
                await saveToFirebase(
                    'Recording completed. Transcript was too short for detailed analysis.',
                    [],
                    [],
                    [],
                    [],
                    {},
                    []
                );
                return;
            }
            
            // Extract all questions from transcript
            const allQuestions = extractAllQuestions(combinedTranscriptRef.current);
            console.log('Extracted questions:', allQuestions);
            
            // Extract keywords from transcript
            const extractedKeywords = extractKeywords(combinedTranscriptRef.current);
            console.log('Extracted keywords:', extractedKeywords);
            
            try {
                const analysisResult = await model.generateContent([
                    `Analyze this complete sales conversation transcript and provide a detailed JSON response (NO MARKDOWN, NO CODE BLOCKS).

Return ONLY valid JSON in this exact structure:
{
  "overallAnalysis": "Overall summary and insights",
  "strengths": [
    "Specific strength 1 with example",
    "Specific strength 2 with example",
    "Specific strength 3 with example"
  ],
  "opportunities": [
    "Specific improvement opportunity 1",
    "Specific improvement opportunity 2",
    "Specific improvement opportunity 3"
  ],
  "competitors": [
    "Competitor name mentioned"
  ],
  "coaching": [
    "Actionable coaching tip 1",
    "Actionable coaching tip 2",
    "Actionable coaching tip 3"
  ]
}

Transcript:
${fullTranscript}`
                ]);

                let analysisText = analysisResult.response.text();
                analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                
                try {
                    const parsed = JSON.parse(analysisText);
                    
                    const coachingCards = [
                        ...(parsed.strengths || []).slice(0, 3).map((s: string) => `STRENGTH: ${s}`),
                        ...(parsed.opportunities || []).slice(0, 3).map((o: string) => `OPPORTUNITY: ${o}`)
                    ];
                    
                    await saveToFirebase(
                        parsed.overallAnalysis || analysisText,
                        coachingCards,
                        parsed.strengths || [],
                        parsed.opportunities || [],
                        parsed.competitors || [],
                        extractedKeywords, // Use extracted keywords instead of Gemini's
                        allQuestions // Use extracted questions instead of Gemini's questions
                    );
                } catch (parseError) {
                    console.error('Failed to parse Gemini JSON:', parseError);
                    await saveToFirebase(
                        analysisText,
                        ['STRENGTH: Call completed successfully'],
                        [],
                        [],
                        [],
                        extractedKeywords, // Use extracted keywords
                        allQuestions // Use extracted questions
                    );
                }

            } catch (apiError) {
                console.error('Gemini API error in full analysis:', apiError);
                await saveToFirebase(
                    'Recording completed. Full transcript available for review.',
                    [],
                    [],
                    [],
                    [],
                    extractedKeywords, // Use extracted keywords
                    allQuestions // Use extracted questions
                );
            }

        } catch (error) {
            console.error('Full analysis error:', error);
            await saveToFirebase(
                'Recording completed with partial data.',
                [],
                [],
                [],
                [],
                {},
                []
            );
        }
    }, [extractAllQuestions, extractKeywords]);

    const startRecording = useCallback(async () => {
        try {
            setRecordingState(RecordingState.RECORDING);
            setError(null);
            
            geminiSegmentsRef.current = [];
            azureSegmentsRef.current = [];
            combinedTranscriptRef.current = [];
            audioChunksRef.current = [];
            speakerNamesRef.current.clear();
            
            recordingStartTimeRef.current = Date.now();
            
            initializeGeminiModel();
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };
            
            mediaRecorder.start(1000);
            await startAzureDiarization();
            
        } catch (error) {
            console.error('Start recording error:', error);
            setError('Failed to start recording. Please check microphone permissions.');
            setRecordingState(RecordingState.IDLE);
        }
    }, [initializeGeminiModel, startAzureDiarization]);

    const stopRecording = useCallback(async () => {
        isManuallyStopping.current = true;
        
        if (azureTranscriberRef.current) {
            await azureTranscriberRef.current.stopTranscribingAsync();
        }
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        
        setRecordingState(RecordingState.ANALYZING);
        await new Promise(resolve => setTimeout(resolve, 2000));
        mergeSegments();
        
        // NEW: Correct speaker identification before analysis
        console.log('Correcting speaker identification...');
        const correctedSegments = await correctSpeakerIdentification(combinedTranscriptRef.current);
        combinedTranscriptRef.current = correctedSegments;
        
        // Update transcript display with corrected speakers
        const displayText = correctedSegments
            .map(seg => `[${seg.speaker}] ${seg.text} ${seg.emotion ? `(${seg.emotion})` : ''}`)
            .join('\n');
        setTranscript(displayText);
        
        await analyzeFullRecording();
    }, [mergeSegments, analyzeFullRecording, correctSpeakerIdentification]);

    const reset = useCallback(() => {
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
    }, [cleanup]);

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