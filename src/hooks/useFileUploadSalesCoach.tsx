import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RecordingState } from '../types';
import { auth, db, storage } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

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
    const [transcript, setTranscript] = useState<string>('');
    const [realtimeFeedback, setRealtimeFeedback] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [currentSpeaker, setCurrentSpeaker] = useState<string>('');
    const [uploadProgress, setUploadProgress] = useState<number>(0);

    const uploadedFileRef = useRef<File | null>(null);
    const transcriptSegmentsRef = useRef<TranscriptSegment[]>([]);
    const speakerNamesRef = useRef<Map<string, string>>(new Map());

    const cleanup = useCallback(() => {
        uploadedFileRef.current = null;
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

    // Convert audio file to base64 for Gemini
    const audioFileToBase64 = async (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    // Get MIME type for Gemini
    const getGeminiMimeType = (file: File): string => {
        const type = file.type.toLowerCase();
        if (type.includes('mp3') || type.includes('mpeg')) return 'audio/mpeg';
        if (type.includes('wav')) return 'audio/wav';
        if (type.includes('m4a') || type.includes('mp4')) return 'audio/mp4';
        if (type.includes('ogg')) return 'audio/ogg';
        if (type.includes('webm')) return 'audio/webm';
        return 'audio/mpeg'; // default
    };

    // Process audio file with Gemini
    const processAudioFile = useCallback(async (audioFile: File) => {
        try {
            setUploadProgress(10);

            // Convert audio to base64
            const base64Audio = await audioFileToBase64(audioFile);
            const mimeType = getGeminiMimeType(audioFile);

            setUploadProgress(20);

            // Initialize Gemini
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

            setUploadProgress(30);

            // Step 1: Get full transcription with speaker diarization
            console.log('Starting transcription...');
            const transcriptionResult = await model.generateContent([
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: mimeType
                    }
                },
                `Transcribe this audio file with speaker diarization. 

For each segment, identify:
1. The speaker (use Speaker A, Speaker B, etc.)
2. The text spoken
3. Approximate timestamp in seconds

Format your response as a JSON array (no markdown, no code blocks):
[
  {"speaker": "Speaker A", "text": "...", "start": 0, "end": 5},
  {"speaker": "Speaker B", "text": "...", "start": 5, "end": 10}
]

Provide the complete transcription.`
            ]);

            setUploadProgress(50);

            let transcriptionText = transcriptionResult.response.text();
            transcriptionText = transcriptionText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            console.log('Raw transcription response:', transcriptionText);

            let segments: TranscriptSegment[] = [];

            try {
                segments = JSON.parse(transcriptionText);
            } catch (parseError) {
                console.error('Failed to parse transcription JSON:', parseError);
                
                // Fallback: Extract text segments manually
                const lines = transcriptionText.split('\n').filter(line => line.trim());
                let currentTime = 0;
                
                segments = lines.map((line, idx) => {
                    const speakerMatch = line.match(/\[(Speaker [A-Z])\]/);
                    const speaker = speakerMatch ? speakerMatch[1] : `Speaker ${String.fromCharCode(65 + (idx % 2))}`;
                    const text = line.replace(/\[Speaker [A-Z]\]/g, '').trim();
                    
                    const segment = {
                        speaker,
                        text,
                        start: currentTime,
                        end: currentTime + 5
                    };
                    
                    currentTime += 5;
                    return segment;
                }).filter(seg => seg.text.length > 0);
            }

            setUploadProgress(60);

            // Step 2: Analyze each segment for emotion and sentiment
            console.log('Analyzing segments...');
            const analyzedSegments: TranscriptSegment[] = [];

            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                setCurrentSpeaker(segment.speaker);

                try {
                    const analysisResult = await model.generateContent([
                        `Analyze this sales conversation segment and provide ONLY a JSON object (no markdown):
{"emotion":"joy/calm/nervousness/anger/neutral","sentiment":"positive/neutral/negative","feedback":"brief coaching tip"}

Text: "${segment.text}"`
                    ]);

                    let analysisText = analysisResult.response.text();
                    analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                    try {
                        const parsed = JSON.parse(analysisText);
                        
                        analyzedSegments.push({
                            ...segment,
                            emotion: parsed.emotion,
                            sentiment: parsed.sentiment
                        });

                        if (parsed.feedback) {
                            setRealtimeFeedback(prev => [parsed.feedback, ...prev].slice(0, 5));
                        }
                    } catch (e) {
                        // Add without analysis if parsing fails
                        analyzedSegments.push(segment);
                    }
                } catch (apiError) {
                    console.error('Segment analysis error:', apiError);
                    analyzedSegments.push(segment);
                }

                // Update progress
                const progress = 60 + (i / segments.length) * 30;
                setUploadProgress(Math.round(progress));
            }

            transcriptSegmentsRef.current = analyzedSegments;

            // Update display transcript
            const displayText = analyzedSegments
                .map(seg => `[${seg.speaker}] ${seg.text} ${seg.emotion ? `(${seg.emotion})` : ''}`)
                .join('\n');
            setTranscript(displayText);

            setUploadProgress(95);

            // Step 3: Full analysis
            await analyzeFullRecording();

        } catch (err) {
            console.error("Audio processing error:", err);
            setError(`Failed to process audio file: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setRecordingState(RecordingState.IDLE);
            setUploadProgress(0);
        }
    }, []);

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

    const calculateMetrics = () => {
        const speakerTime = new Map<string, number>();
        let questionCount = 0;
        let totalSentimentScore = 0;
        let sentimentCount = 0;

        transcriptSegmentsRef.current.forEach(seg => {
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
        for (let i = 0; i < transcriptSegmentsRef.current.length; i += 3) {
            const seg = transcriptSegmentsRef.current[i];
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
            if (!uploadedFileRef.current) throw new Error("No audio file found");

            setUploadProgress(98);

            // Upload audio file to Firebase Storage
            const timestamp = Date.now();
            const storageRef = ref(storage, `recordings/${user.uid}/${timestamp}_${uploadedFileRef.current.name}`);
            await uploadBytes(storageRef, uploadedFileRef.current);
            const audioUrl = await getDownloadURL(storageRef);

            // Calculate metrics
            const metrics = calculateMetrics();
            const coachingCards = generateCoachingCards(geminiAnalysis);

            // Save to Firestore
            await addDoc(collection(db, "recordings"), {
                title: `Sales Call - ${new Date().toLocaleDateString()} (Uploaded)`,
                audioFileUrl: audioUrl,
                transcript: transcriptSegmentsRef.current.map(s => `[${s.speaker}] ${s.text}`),
                transcriptSegments: JSON.stringify(transcriptSegmentsRef.current),
                sentimentGraph: JSON.stringify(generateSentimentGraph()),
                coachingCard: coachingCards,
                geminiFullAnalysis: geminiAnalysis,
                recordingStats: metrics,
                speakers: JSON.stringify(Array.from(speakerNamesRef.current.entries())),
                userId: user.uid,
                date: serverTimestamp(),
                duration: formatDuration(),
                uploadedFileName: uploadedFileRef.current.name
            });

            setUploadProgress(100);
            setRecordingState(RecordingState.DONE);
            alert('Recording analyzed and saved successfully!');

        } catch (error) {
            console.error('Save error:', error);
            setError('Failed to save recording');
            setUploadProgress(0);
        }
    };

    // Analyze complete recording with Gemini
    const analyzeFullRecording = useCallback(async () => {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
            
            const fullTranscript = transcriptSegmentsRef.current
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

    // Main function to handle file upload
    const uploadAndAnalyzeFile = async (file: File) => {
        // Validate file type
        const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/webm'];
        if (!validTypes.some(type => file.type.includes(type.split('/')[1]))) {
            setError('Invalid file type. Please upload an audio file (MP3, WAV, M4A, etc.)');
            return;
        }

        // Validate file size (max 100MB)
        const maxSize = 100 * 1024 * 1024; // 100MB
        if (file.size > maxSize) {
            setError('File is too large. Maximum size is 100MB.');
            return;
        }

        setRecordingState(RecordingState.RECORDING);
        setTranscript('');
        setRealtimeFeedback([]);
        setError(null);
        setUploadProgress(0);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();
        uploadedFileRef.current = file;

        try {
            // Process the audio file with Gemini
            await processAudioFile(file);

        } catch (error) {
            console.error('Failed to analyze file:', error);
            setError('Could not analyze the audio file. Please check the file format and try again.');
            setRecordingState(RecordingState.IDLE);
            setUploadProgress(0);
        }
    };

    const reset = () => {
        cleanup();
        setRecordingState(RecordingState.IDLE);
        setTranscript('');
        setRealtimeFeedback([]);
        setError(null);
        setUploadProgress(0);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();
        uploadedFileRef.current = null;
    };

    useEffect(() => {
        return () => cleanup();
    }, [cleanup]);

    return {
        recordingState,
        transcript,
        realtimeFeedback,
        error,
        isSDKLoading: false, // No SDK needed anymore
        currentSpeaker,
        uploadProgress,
        combinedSegments: transcriptSegmentsRef.current,
        uploadAndAnalyzeFile,
        reset
    };
};