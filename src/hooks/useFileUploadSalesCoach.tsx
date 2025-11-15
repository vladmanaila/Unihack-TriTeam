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
    const [error, setError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [currentFile, setCurrentFile] = useState<File | null>(null);

    const transcriptSegmentsRef = useRef<TranscriptSegment[]>([]);
    const speakerNamesRef = useRef<Map<string, string>>(new Map());

    const cleanup = useCallback(() => {
        setCurrentFile(null);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();
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
        return 'audio/mpeg';
    };

    // SINGLE API CALL - Procesează totul într-un singur apel
    const processAudioWithSingleCall = useCallback(async (audioFile: File) => {
        try {
            setUploadProgress(10);

            // Convert audio to base64
            const base64Audio = await audioFileToBase64(audioFile);
            const mimeType = getGeminiMimeType(audioFile);

            setUploadProgress(30);

            // Initialize Gemini
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: 'gemini-2.0-flash-exp',
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 4000,
                }
            });

            setUploadProgress(50);

            // SINGLE COMPREHENSIVE PROMPT - generează toate datele într-un singur răspuns
            console.log('Starting comprehensive analysis...');
            const analysisResult = await model.generateContent([
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: mimeType
                    }
                },
                `Analyze this sales conversation audio and provide a COMPLETE analysis in a SINGLE JSON response.

REQUIRED OUTPUT FORMAT (ONLY JSON, no markdown):
{
  "transcription": [
    {"speaker": "Speaker A", "text": "exact text", "start": 0.0, "end": 5.2, "emotion": "calm", "sentiment": "positive"},
    {"speaker": "Speaker B", "text": "exact text", "start": 5.2, "end": 12.8, "emotion": "engaged", "sentiment": "neutral"}
  ],
  "overallAnalysis": "Comprehensive summary of the conversation",
  "strengths": ["Strength 1 with example", "Strength 2 with example", "Strength 3 with example"],
  "opportunities": ["Opportunity 1 with example", "Opportunity 2 with example", "Opportunity 3 with example"],
  "competitors": ["Competitor A", "Competitor B"],
  "keywords": {"pricing": 5, "demo": 3, "features": 7},
  "questions": ["Question 1?", "Question 2?", "Question 3?"],
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

ANALYSIS REQUIREMENTS:
1. TRANSCRIPTION: Complete transcript with speaker diarization, timestamps, emotions, and sentiments
2. STRENGTHS: 3-5 specific things done well with concrete examples
3. OPPORTUNITIES: 3-5 specific areas for improvement with examples
4. COMPETITORS: Any competitor companies mentioned
5. KEYWORDS: Important business keywords with frequency counts
6. QUESTIONS: All questions asked during the call
7. COACHING TIPS: 3-5 actionable coaching recommendations
8. METRICS: Calculate realistic metrics based on conversation analysis

Be specific and use actual examples from the conversation.`
            ]);

            setUploadProgress(80);

            let analysisText = analysisResult.response.text();
            analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            try {
                const parsedData = JSON.parse(analysisText);
                
                // Set transcript segments
                transcriptSegmentsRef.current = parsedData.transcription || [];
                
                // Save to Firebase with ALL data
                await saveCompleteAnalysisToFirebase(audioFile, parsedData);
                
            } catch (parseError) {
                console.error('Failed to parse comprehensive analysis:', parseError);
                throw new Error('Failed to parse AI analysis response');
            }

        } catch (err) {
            console.error("Comprehensive analysis error:", err);
            setError(`Failed to analyze audio: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setRecordingState(RecordingState.IDLE);
            setUploadProgress(0);
        }
    }, []);

    // === FORMAT TIME HELPERS ===
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

    // === SENTIMENT GRAPH ===
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

    // === SAVE COMPLETE ANALYSIS TO FIREBASE ===
    // === SAVE COMPLETE ANALYSIS TO FIREBASE ===
const saveCompleteAnalysisToFirebase = async (audioFile: File, analysisData: any) => {
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

        // Generate coaching cards from strengths and opportunities - FIXED LENGTH
       const coachingCards = [
    ...(analysisData.strengths || []).slice(0, 3).map((s: string) => `STRENGTH: ${s}`),
    ...(analysisData.opportunities || []).slice(0, 3).map((o: string) => `OPPORTUNITY: ${o}`)
];

        const truncateLongText = (text: string, maxLength: number = 500): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
};


        // Save COMPLETE data to Firestore
        await addDoc(collection(db, "recordings"), {
            title: `Sales Call - ${dateStr} at ${timeStr} (Uploaded)`,
            audioFileUrl: audioUrl,
            transcript: (analysisData.transcription || []).map((s: TranscriptSegment) => `[${s.speaker}] ${s.text}`),
            transcriptSegments: JSON.stringify(analysisData.transcription || []),
            sentimentGraph: JSON.stringify(generateSentimentGraph(analysisData.transcription || [])),
            coachingCard: coachingCards.length > 0 ? coachingCards : ['STRENGTH: Call completed successfully'],
            strengths: (analysisData.strengths || []).map(s => truncateLongText(s)),
            opportunities: (analysisData.opportunities || []).map(o => truncateLongText(o)),
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
        console.log('Recording analyzed and saved successfully with ALL data in single call!');

    } catch (error) {
        console.error('Save error:', error);
        setError('Failed to save recording');
        setUploadProgress(0);
    }
};
    // Main function to handle file upload - SINGLE API CALL
    const uploadAndAnalyzeFile = async (file: File) => {
        // Validate file type
        const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/webm'];
        if (!validTypes.some(type => file.type.includes(type.split('/')[1]))) {
            setError('Invalid file type. Please upload an audio file (MP3, WAV, M4A, etc.)');
            return;
        }

        // Validate file size (max 100MB)
        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
            setError('File is too large. Maximum size is 100MB.');
            return;
        }

        setRecordingState(RecordingState.RECORDING);
        setError(null);
        setUploadProgress(0);
        setCurrentFile(file);
        transcriptSegmentsRef.current = [];
        speakerNamesRef.current.clear();

        try {
            // Process the audio file with SINGLE API CALL
            await processAudioWithSingleCall(file);

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
        reset
    };
};