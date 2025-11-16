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

interface AzureSpeakerSegment {
    speakerId: string;
    text: string;
    start: number;
    end: number;
}

interface TranscriptSegment {
    speaker: string;
    text: string;
    emotion?: string;
    sentiment?: string;
    start: number;
    end: number;
}

export const useFileUploadSalesCoach = () => {
    const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
    const [error, setError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [currentFile, setCurrentFile] = useState<File | null>(null);
    const [isSDKLoading, setIsSDKLoading] = useState(true);

    const transcriptSegmentsRef = useRef<TranscriptSegment[]>([]);
    const speakerNamesRef = useRef<Map<string, string>>(new Map());
    const azureSegmentsRef = useRef<AzureSpeakerSegment[]>([]);

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
            setError("Azure Speech SDK failed to load. Check your internet connection.");
            setIsSDKLoading(false);
        };
        document.body.appendChild(script);
    }, []);

    const cleanup = useCallback(() => {
        setCurrentFile(null);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();
        azureSegmentsRef.current = [];
    }, []);

    // Get speaker name helper
    const getSpeakerName = useCallback((speakerId: string): string => {
        if (speakerNamesRef.current.has(speakerId)) {
            return speakerNamesRef.current.get(speakerId)!;
        }
        
        const count = speakerNamesRef.current.size;
        const name = `Speaker ${String.fromCharCode(65 + count)}`;
        speakerNamesRef.current.set(speakerId, name);
        return name;
    }, []);

    // Validate Azure configuration
    const validateAzureConfig = useCallback(() => {
        if (!AZURE_KEY || AZURE_KEY === 'undefined' || !AZURE_REGION || AZURE_REGION === 'undefined') {
            throw new Error("Azure Speech credentials not configured properly");
        }
        
        if (!(window as any).SpeechSDK) {
            throw new Error("Azure Speech SDK not loaded");
        }
    }, []);

    // Convert audio file to WAV format for Azure
    const convertToWav = async (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target?.result as ArrayBuffer;
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    
                    // Convert to WAV with optimal settings for speech recognition
                    const numberOfChannels = 1; // Mono for better diarization
                    const sampleRate = 16000; // 16kHz for speech recognition
                    
                    // Create offline context for resampling
                    const offlineContext = new OfflineAudioContext(numberOfChannels, audioBuffer.length, sampleRate);
                    const bufferSource = offlineContext.createBufferSource();
                    bufferSource.buffer = audioBuffer;
                    bufferSource.connect(offlineContext.destination);
                    bufferSource.start();
                    
                    const renderedBuffer = await offlineContext.startRendering();
                    
                    // Create WAV file from rendered buffer
                    const wavBuffer = audioBufferToWav(renderedBuffer);
                    resolve(new Blob([wavBuffer], { type: 'audio/wav' }));
                } catch (error) {
                    console.error('Audio conversion error:', error);
                    reject(new Error(`Failed to convert audio: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
            };

            reader.onerror = () => reject(new Error('Failed to read audio file'));
            reader.readAsArrayBuffer(file);
        });
    };

    // Helper function to convert AudioBuffer to WAV
    const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = buffer.length * blockAlign;
        
        const bufferSize = 44 + dataSize;
        const arrayBuffer = new ArrayBuffer(bufferSize);
        const view = new DataView(arrayBuffer);
        
        // Write WAV header
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        let offset = 0;
        
        // RIFF identifier
        writeString(offset, 'RIFF'); offset += 4;
        // File size
        view.setUint32(offset, 36 + dataSize, true); offset += 4;
        // RIFF type
        writeString(offset, 'WAVE'); offset += 4;
        // Format chunk identifier
        writeString(offset, 'fmt '); offset += 4;
        // Format chunk length
        view.setUint32(offset, 16, true); offset += 4;
        // Sample format (PCM)
        view.setUint16(offset, format, true); offset += 2;
        // Channel count
        view.setUint16(offset, numChannels, true); offset += 2;
        // Sample rate
        view.setUint32(offset, sampleRate, true); offset += 4;
        // Byte rate (sample rate * block align)
        view.setUint32(offset, byteRate, true); offset += 4;
        // Block align (channel count * bytes per sample)
        view.setUint16(offset, blockAlign, true); offset += 2;
        // Bits per sample
        view.setUint16(offset, bitDepth, true); offset += 2;
        // Data chunk identifier
        writeString(offset, 'data'); offset += 4;
        // Data chunk length
        view.setUint32(offset, dataSize, true); offset += 4;
        
        // Write audio data
        for (let i = 0; i < buffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
                const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
                view.setInt16(offset, int16Sample, true);
                offset += 2;
            }
        }
        
        return arrayBuffer;
    };

    // Process audio with Azure for speaker diarization - FIXED VERSION
    const processAudioWithAzure = async (audioFile: File): Promise<AzureSpeakerSegment[]> => {
        return new Promise(async (resolve, reject) => {
            const sdk = (window as any).SpeechSDK;
            let transcriber: any = null;
            const segments: AzureSpeakerSegment[] = [];
            let isCompleted = false;

            const complete = (result: AzureSpeakerSegment[] | Error) => {
                if (isCompleted) return;
                isCompleted = true;
                
                if (transcriber) {
                    try {
                        transcriber.close();
                    } catch (e) {
                        console.warn('Error closing transcriber:', e);
                    }
                }
                
                if (result instanceof Error) {
                    reject(result);
                } else {
                    resolve(result);
                }
            };

            try {
                setUploadProgress(20);
                validateAzureConfig();

                // Convert to WAV for Azure
                console.log('Converting audio to WAV format...');
                const wavBlob = await convertToWav(audioFile);
                const wavArrayBuffer = await wavBlob.arrayBuffer();

                setUploadProgress(30);

                // Create speech config with optimized settings
                const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_KEY, AZURE_REGION);
                speechConfig.speechRecognitionLanguage = "en-US";
                speechConfig.outputFormat = sdk.OutputFormat.Detailed;
                
                // Set optimized properties for conversation transcription
                speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EnableAudioLogging, "false");
                speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "10000");
                speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "2000");
                speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_SpeechTimeoutMs, "30000");

                // Create push stream
                const pushStream = sdk.AudioInputStream.createPushStream();
                const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

                // Create conversation transcriber
                transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
                
                console.log('Azure transcriber created, starting transcription...');

                // Event handlers
                transcriber.transcribing = (_s: any, e: any) => {
                    if (e.result?.text) {
                        console.log("Transcribing:", e.result.text);
                    }
                };

                transcriber.transcribed = (_s: any, e: any) => {
                    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
                        const rawSpeakerId = e.result.speakerId || 'Unknown';
                        const offset = e.result.offset / 10000000; // Convert to seconds
                        const duration = e.result.duration / 10000000; // Convert to seconds
                        
                        const segment: AzureSpeakerSegment = {
                            speakerId: getSpeakerName(rawSpeakerId),
                            text: e.result.text.trim(),
                            start: offset,
                            end: offset + duration
                        };
                        
                        segments.push(segment);
                        console.log(`🎤 ${segment.speakerId}: "${segment.text}" [${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s]`);
                    }
                };

                transcriber.sessionStarted = (_s: any, _e: any) => {
                    console.log("Azure transcription session started");
                };

                transcriber.sessionStopped = (_s: any, _e: any) => {
                    console.log("Azure transcription session stopped");
                    complete(segments);
                };

                transcriber.canceled = (_s: any, e: any) => {
                    console.log(`Azure transcription canceled: ${e.reason}`);
                    
                    if (e.reason === sdk.CancellationReason.Error) {
                        const errorMsg = `Azure transcription error: ${e.errorDetails || 'Unknown error'}`;
                        console.error(errorMsg);
                        complete(new Error(errorMsg));
                    } else if (e.reason === sdk.CancellationReason.EndOfStream) {
                        // Normal completion
                        console.log("Azure transcription completed normally (EndOfStream)");
                        complete(segments);
                    } else {
                        complete(segments); // Resolve with whatever we have
                    }
                };

                // Start transcription
                await transcriber.startTranscribingAsync();
                console.log("Azure transcription started successfully");
                
                setUploadProgress(40);

                // Push audio data in optimized chunks
                const uint8Array = new Uint8Array(wavArrayBuffer);
                const chunkSize = 8192; // Optimal chunk size for streaming
                let bytesSent = 0;
                
                const sendChunk = () => {
                    if (bytesSent >= uint8Array.length || isCompleted) {
                        console.log("Audio streaming completed, closing stream...");
                        pushStream.close();
                        return;
                    }
                    
                    const nextChunk = bytesSent + chunkSize;
                    const chunk = uint8Array.slice(bytesSent, Math.min(nextChunk, uint8Array.length));
                    
                    try {
                        pushStream.write(chunk);
                        bytesSent = nextChunk;
                        
                        // Update progress
                        const progress = 40 + (bytesSent / uint8Array.length) * 20;
                        setUploadProgress(Math.min(60, Math.floor(progress)));
                        
                        // Continue streaming with minimal delay
                        if (bytesSent < uint8Array.length) {
                            setTimeout(sendChunk, 0);
                        } else {
                            console.log("All audio data sent, closing stream...");
                            pushStream.close();
                        }
                    } catch (chunkError) {
                        console.error("Error sending audio chunk:", chunkError);
                        complete(new Error("Failed to stream audio data to Azure"));
                    }
                };
                
                // Start streaming audio data
                sendChunk();

            } catch (error) {
                console.error('Azure processing setup error:', error);
                complete(error instanceof Error ? error : new Error('Azure processing failed'));
            }
        });
    };

    // Analyze segments with Gemini
    const analyzeSegmentsWithGemini = async (segments: AzureSpeakerSegment[]) => {
        try {
            setUploadProgress(70);

            if (!GEMINI_API_KEY || GEMINI_API_KEY === 'undefined') {
                throw new Error("Gemini API key not configured");
            }

            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: 'gemini-2.0-flash-exp',
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 4000,
                }
            });

            const fullTranscript = segments
                .map(seg => `[${seg.speakerId}] ${seg.text}`)
                .join('\n');

            if (!fullTranscript.trim()) {
                throw new Error("No transcript content to analyze");
            }

            console.log('Analyzing with Gemini...');
            const analysisResult = await model.generateContent([
                `Analyze this sales conversation transcript and provide a COMPLETE analysis in JSON format.

TRANSCRIPT WITH SPEAKERS:
${fullTranscript}

REQUIRED OUTPUT (ONLY JSON, no markdown):
{
  "segmentAnalysis": [
    {"index": 0, "emotion": "calm/engaged/nervous/neutral", "sentiment": "positive/neutral/negative"},
    {"index": 1, "emotion": "...", "sentiment": "..."}
  ],
  "overallAnalysis": "Comprehensive summary",
  "strengths": ["Strength 1 with example", "Strength 2", "Strength 3"],
  "opportunities": ["Opportunity 1", "Opportunity 2", "Opportunity 3"],
  "competitors": ["Competitor names mentioned"],
  "keywords": {"keyword": count},
  "questions": ["All questions asked"],
  "coachingTips": ["Tip 1", "Tip 2", "Tip 3"],
  "metrics": {
    "talkToListenRatio": "60:40",
    "sentimentScoreAvg": "75",
    "engagementPercentage": "80",
    "questionCount": "5",
    "strengthsCount": "3",
    "missedOpportunitiesCount": "2",
    "fillerWordsCount": "8"
  }
}

Provide emotion/sentiment for each segment index and complete analysis.`
            ]);

            setUploadProgress(85);

            let analysisText = analysisResult.response.text();
            analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            try {
                const parsedData = JSON.parse(analysisText);
                
                // Merge Azure segments with Gemini analysis
                const enrichedSegments: TranscriptSegment[] = segments.map((seg, idx) => {
                    const analysis = parsedData.segmentAnalysis?.find((a: any) => a.index === idx);
                    return {
                        speaker: seg.speakerId,
                        text: seg.text,
                        emotion: analysis?.emotion || 'neutral',
                        sentiment: analysis?.sentiment || 'neutral',
                        start: seg.start,
                        end: seg.end
                    };
                });

                transcriptSegmentsRef.current = enrichedSegments;
                
                return {
                    segments: enrichedSegments,
                    analysis: parsedData
                };

            } catch (parseError) {
                console.error('Failed to parse Gemini response:', parseError, 'Raw response:', analysisText);
                throw new Error('Failed to parse AI analysis response');
            }

        } catch (error) {
            console.error('Gemini analysis error:', error);
            throw error;
        }
    };

    // Format time helpers
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDuration = (): string => {
        if (transcriptSegmentsRef.current.length === 0) return "0:00";
        const last = transcriptSegmentsRef.current[transcriptSegmentsRef.current.length - 1];
        return formatTime(last.end);
    };

    // Generate sentiment graph
    const generateSentimentGraph = (segments: TranscriptSegment[]) => {
        const points = [];
        let cumulativeSentiment = 0;
        let segmentCount = 0;

        points.push({ time: "0:00", sentiment: 50 });

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            
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

    // Save to Firebase
    const saveCompleteAnalysisToFirebase = async (audioFile: File, segments: TranscriptSegment[], analysisData: any) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");

            setUploadProgress(90);

            // Upload audio file
            const timestamp = Date.now();
            const storageRef = ref(storage, `recordings/${user.uid}/${timestamp}_${audioFile.name}`);
            await uploadBytes(storageRef, audioFile);
            const audioUrl = await getDownloadURL(storageRef);

            // Format title
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            // Generate coaching cards
            const coachingCards = [
                ...(analysisData.strengths || []).slice(0, 3).map((s: string) => `STRENGTH: ${s}`),
                ...(analysisData.opportunities || []).slice(0, 3).map((o: string) => `OPPORTUNITY: ${o}`)
            ];

            const truncateLongText = (text: string, maxLength: number = 500): string => {
                if (text.length <= maxLength) return text;
                return text.substring(0, maxLength - 3) + '...';
            };

            // Save to Firestore
            await addDoc(collection(db, "recordings"), {
                title: `Sales Call - ${dateStr} at ${timeStr} (Uploaded)`,
                audioFileUrl: audioUrl,
                transcript: segments.map(s => `[${s.speaker}] ${s.text}`),
                transcriptSegments: JSON.stringify(segments),
                sentimentGraph: JSON.stringify(generateSentimentGraph(segments)),
                coachingCard: coachingCards.length > 0 ? coachingCards : ['STRENGTH: Call completed successfully'],
                strengths: (analysisData.strengths || []).map((s: string) => truncateLongText(s)),
                opportunities: (analysisData.opportunities || []).map((o: string) => truncateLongText(o)),
                competitors: analysisData.competitors || [],
                keywords: analysisData.keywords || {},
                questions: analysisData.questions || [],
                geminiFullAnalysis: analysisData.overallAnalysis || 'Analysis completed successfully',
                recordingStats: analysisData.metrics || {
                    talkToListenRatio: "50:50",
                    sentimentScoreAvg: "50",
                    engagementPercentage: "50",
                    questionCount: "0",
                    strengthsCount: "0",
                    missedOpportunitiesCount: "0",
                    fillerWordsCount: "0",
                    keywordsDetected: JSON.stringify({}),
                    competitorMentions: JSON.stringify({}),
                    objectionsDetected: JSON.stringify([])
                },
                speakers: JSON.stringify(Array.from(speakerNamesRef.current.entries())),
                userId: user.uid,
                date: serverTimestamp(),
                duration: formatDuration(),
                uploadedFileName: audioFile.name
            });

            setUploadProgress(100);
            setRecordingState(RecordingState.DONE);
            console.log('Recording analyzed and saved successfully with Azure diarization!');

        } catch (error) {
            console.error('Save error:', error);
            setError('Failed to save recording');
            setUploadProgress(0);
        }
    };

    // Main upload and analyze function
    const uploadAndAnalyzeFile = async (file: File) => {
        // Validate file type
        const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/webm'];
        if (!validTypes.some(type => file.type.includes(type.split('/')[1]))) {
            setError('Invalid file type. Please upload an audio file (MP3, WAV, M4A, etc.)');
            return;
        }

        // Validate file size (max 25MB for Azure - reduced for stability)
        const maxSize = 25 * 1024 * 1024;
        if (file.size > maxSize) {
            setError('File is too large for processing. Maximum size is 25MB.');
            return;
        }

        if (isSDKLoading) {
            setError('Azure Speech SDK is still loading. Please wait...');
            return;
        }

        // Validate Azure config
        try {
            validateAzureConfig();
        } catch (configError) {
            setError(configError.message);
            return;
        }

        setRecordingState(RecordingState.RECORDING);
        setError(null);
        setUploadProgress(0);
        setCurrentFile(file);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();
        azureSegmentsRef.current = [];

        try {
            // Step 1: Process with Azure for speaker diarization
            console.log('Step 1: Processing with Azure...');
            const azureSegments = await processAudioWithAzure(file);
            
            if (azureSegments.length === 0) {
                throw new Error("No speech detected in the audio file. Please check the audio quality and try again.");
            }
            
            azureSegmentsRef.current = azureSegments;

            // Step 2: Analyze with Gemini
            console.log('Step 2: Analyzing with Gemini...');
            const { segments, analysis } = await analyzeSegmentsWithGemini(azureSegments);

            // Step 3: Save to Firebase
            console.log('Step 3: Saving to Firebase...');
            await saveCompleteAnalysisToFirebase(file, segments, analysis);

        } catch (error) {
            console.error('Failed to analyze file:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            setError(`Analysis failed: ${errorMessage}`);
            setRecordingState(RecordingState.IDLE);
            setUploadProgress(0);
        }
    };

    const reset = () => {
        cleanup();
        setRecordingState(RecordingState.IDLE);
        setError(null);
        setUploadProgress(0);
    };

    useEffect(() => {
        return () => cleanup();
    }, [cleanup]);

    return {
        recordingState,
        error,
        uploadProgress,
        uploadAndAnalyzeFile,
        reset,
        isSDKLoading
    };
};