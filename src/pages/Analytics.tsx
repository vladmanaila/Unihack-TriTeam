import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Pause, Volume2, VolumeX, ChevronDown, ChevronUp, Download, TrendingUp, Users, MessageCircle } from "lucide-react";
import jsPDF from 'jspdf';

interface RecordingData {
  title: string;
  audioFileUrl: string;
  transcript: string[];
  transcriptSegments: string;
  sentimentGraph: string;
  coachingCard: string[];
  strengths: string[];
  opportunities: string[];
  competitors: string[];
  keywords: { [key: string]: number };
  questions: string[];
  geminiFullAnalysis: string;
  recordingStats: {
    sentimentScoreAvg: string;
    engagementPercentage: string;
    talkToListenRatio?: string;
    questionCount?: string;
    strengthsCount: string;
    missedOpportunitiesCount: string;
  };
  duration?: string;
  date: any;
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  emotion?: string;
  sentiment?: string;
  start: number;
  end: number;
}

const Analytics = () => {
  const { id } = useParams<{ id: string }>();
  const [recording, setRecording] = useState<RecordingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  
  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const fetchRecording = async () => {
      if (!id) return;
      
      try {
        const docRef = doc(db, "recordings", id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data() as RecordingData;
          setRecording(data);
          
          if (data.transcriptSegments) {
            try {
              const segments = JSON.parse(data.transcriptSegments);
              setTranscriptSegments(segments);
            } catch (e) {
              console.error('Error parsing transcript segments:', e);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching recording:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecording();
  }, [id]);

  // Audio player functions
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get speaker color
  const getSpeakerColor = (speaker: string) => {
    const colors = [
      'bg-blue-100 border-blue-300 text-blue-800',
      'bg-green-100 border-green-300 text-green-800',
      'bg-purple-100 border-purple-300 text-purple-800',
      'bg-orange-100 border-orange-300 text-orange-800',
      'bg-pink-100 border-pink-300 text-pink-800'
    ];
    const speakerIndex = speaker.charCodeAt(speaker.length - 1) % colors.length;
    return colors[speakerIndex];
  };

  // Check if text contains questions
  const containsQuestion = (text: string) => {
    return text.includes('?');
  };

  // Download PDF Report
  const downloadPDFReport = async () => {
    if (!recording) return;

    setIsGeneratingPDF(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      let yPosition = 20;
      const lineHeight = 7;
      const margin = 20;
      const pageWidth = pdf.internal.pageSize.getWidth();

      // Title
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text(recording.title, margin, yPosition);
      yPosition += lineHeight * 2;

      // Date and Duration
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      const dateStr = recording.date?.toDate?.() ? recording.date.toDate().toLocaleDateString() : 'Unknown date';
      pdf.text(`Date: ${dateStr} | Duration: ${recording.duration || "N/A"}`, margin, yPosition);
      yPosition += lineHeight * 2;

      // Key Metrics
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Key Metrics', margin, yPosition);
      yPosition += lineHeight;

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      const metrics = [
        `Average Sentiment: ${recording.recordingStats.sentimentScoreAvg}%`,
        `Talk-to-Listen Ratio: ${recording.recordingStats.talkToListenRatio || 'N/A'}`,
        `Engagement: ${recording.recordingStats.engagementPercentage}%`
      ];

      metrics.forEach(metric => {
        if (yPosition > 270) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text(metric, margin, yPosition);
        yPosition += lineHeight;
      });

      yPosition += lineHeight;

      // Coaching Insights
      if (recording.coachingCard.length > 0) {
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text('Coaching Insights', margin, yPosition);
        yPosition += lineHeight;

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        recording.coachingCard.forEach(card => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(`• ${card}`, margin, yPosition);
          yPosition += lineHeight;
        });
        yPosition += lineHeight;
      }

      // Strengths
      if (recording.strengths && recording.strengths.length > 0) {
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text('Strengths', margin, yPosition);
        yPosition += lineHeight;

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        recording.strengths.forEach(strength => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(`• ${strength}`, margin, yPosition);
          yPosition += lineHeight;
        });
        yPosition += lineHeight;
      }

      // Opportunities
      if (recording.opportunities && recording.opportunities.length > 0) {
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text('Growth Opportunities', margin, yPosition);
        yPosition += lineHeight;

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        recording.opportunities.forEach(opportunity => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(`• ${opportunity}`, margin, yPosition);
          yPosition += lineHeight;
        });
        yPosition += lineHeight;
      }

      // Keywords
      if (recording.keywords && Object.keys(recording.keywords).length > 0) {
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text('Important Keywords', margin, yPosition);
        yPosition += lineHeight;

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        const keywordText = Object.entries(recording.keywords)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([keyword, count]) => `${keyword} (${count})`)
          .join(', ');
        
        if (yPosition > 270) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text(keywordText, margin, yPosition, { maxWidth: pageWidth - margin * 2 });
        yPosition += lineHeight * 2;
      }

      // Questions
      if (recording.questions && recording.questions.length > 0) {
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        if (yPosition > 250) {
          pdf.addPage();
          yPosition = 20;
        }
        pdf.text('Questions Asked', margin, yPosition);
        yPosition += lineHeight;

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        recording.questions.forEach(question => {
          if (yPosition > 270) {
            pdf.addPage();
            yPosition = 20;
          }
          pdf.text(`• ${question}`, margin, yPosition);
          yPosition += lineHeight;
        });
        yPosition += lineHeight;
      }

      // Transcript Preview
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      if (yPosition > 250) {
        pdf.addPage();
        yPosition = 20;
      }
      pdf.text('Transcript Preview', margin, yPosition);
      yPosition += lineHeight;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const transcriptPreview = recording.transcript.slice(0, 10).join('\n');
      if (yPosition > 270) {
        pdf.addPage();
        yPosition = 20;
      }
      pdf.text(transcriptPreview, margin, yPosition, { maxWidth: pageWidth - margin * 2 });

      // Add metadata
      pdf.setProperties({
        title: `${recording.title} - Sales Call Analysis`,
        subject: 'Sales Conversation Analysis Report',
        author: 'Sales Coach AI',
        keywords: 'sales, conversation, analysis, coaching',
        creator: 'Sales Coach AI'
      });

      pdf.save(`${recording.title.replace(/[^a-z0-9]/gi, '_')}_analysis.pdf`);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF report. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading analytics...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-8">
          <p className="text-center text-muted-foreground">Recording not found</p>
        </div>
      </div>
    );
  }

  const sentimentData = JSON.parse(recording.sentimentGraph || '[]');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        {/* Header with Download Button */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{recording.title}</h1>
            <p className="text-muted-foreground">
              Duration: {recording.duration || "N/A"}
            </p>
          </div>
          <Button 
            onClick={downloadPDFReport} 
            disabled={isGeneratingPDF}
            className="flex items-center gap-2"
            variant="outline"
          >
            <Download className="h-4 w-4" />
            {isGeneratingPDF ? "Generating PDF..." : "Download PDF"}
          </Button>
        </div>

        {/* Audio Player */}
        {recording.audioFileUrl && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                Audio Playback
              </CardTitle>
            </CardHeader>
            <CardContent>
              <audio
                ref={audioRef}
                src={recording.audioFileUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />
              
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Button
                    onClick={togglePlayPause}
                    size="lg"
                    className="w-12 h-12 rounded-full"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                  </Button>
                  
                  <Button
                    onClick={toggleMute}
                    variant="outline"
                    size="icon"
                  >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                  
                  <div className="flex-1 flex items-center gap-3">
                    <span className="text-sm text-muted-foreground min-w-[40px]">
                      {formatTime(currentTime)}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max={duration || 0}
                      value={currentTime}
                      onChange={handleSeek}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm text-muted-foreground min-w-[40px]">
                      {formatTime(duration)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Key Metrics - Horizontal Layout */}
        <Card className="shadow-card mb-8">
          <CardHeader>
            <CardTitle>Conversation Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Avg Sentiment */}
              <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex justify-center mb-2">
                  <TrendingUp className="h-8 w-8 text-blue-600" />
                </div>
                <p className="text-sm text-blue-600 font-semibold mb-1">Avg. Sentiment</p>
                <p className="text-3xl font-bold text-blue-700">{recording.recordingStats.sentimentScoreAvg}%</p>
                <p className="text-xs text-blue-500 mt-1">
                  {parseInt(recording.recordingStats.sentimentScoreAvg) >= 70 ? 'Positive' : 
                   parseInt(recording.recordingStats.sentimentScoreAvg) >= 50 ? 'Neutral' : 'Negative'}
                </p>
              </div>

              {/* Talk to Listen Ratio */}
              <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex justify-center mb-2">
                  <Users className="h-8 w-8 text-green-600" />
                </div>
                <p className="text-sm text-green-600 font-semibold mb-1">Talk to Listen Ratio</p>
                <p className="text-3xl font-bold text-green-700">{recording.recordingStats.talkToListenRatio || 'N/A'}</p>
                <p className="text-xs text-green-500 mt-1">Sales : Customer</p>
              </div>

              {/* Engagement */}
              <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="flex justify-center mb-2">
                  <MessageCircle className="h-8 w-8 text-purple-600" />
                </div>
                <p className="text-sm text-purple-600 font-semibold mb-1">Engagement</p>
                <p className="text-3xl font-bold text-purple-700">{recording.recordingStats.engagementPercentage}%</p>
                <p className="text-xs text-purple-500 mt-1">
                  {parseInt(recording.recordingStats.engagementPercentage) >= 70 ? 'High' : 
                   parseInt(recording.recordingStats.engagementPercentage) >= 40 ? 'Medium' : 'Low'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Coaching Insights */}
        <Card className="shadow-card mb-8">
          <CardHeader>
            <CardTitle>Coaching Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recording.coachingCard.map((card, index) => {
                const isStrength = card.startsWith('STRENGTH');
                return (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border-l-4 ${
                      isStrength
                        ? 'bg-green-50 border-green-500'
                        : 'bg-yellow-50 border-yellow-500'
                    }`}
                  >
                    <p className="text-sm">{card}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Sentiment Over Time */}
        <Card className="shadow-card mb-8">
          <CardHeader>
            <CardTitle>Sentiment Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sentimentData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis domain={[0, 100]} />
                <Tooltip 
                  formatter={(value) => [`${value}%`, 'Sentiment']}
                  labelFormatter={(label) => `Time: ${label}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="sentiment" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  dot={{ fill: '#8884d8', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#8884d8' }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="text-center text-sm text-muted-foreground mt-4">
              <p>Sentiment evolution throughout the conversation</p>
              <p className="text-xs">Points show average sentiment at different time intervals</p>
            </div>
          </CardContent>
        </Card>

        {/* Strengths */}
        {recording.strengths && recording.strengths.length > 0 && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <span>✓</span>
                Strengths Identified ({recording.strengths.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recording.strengths.map((strength, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                    <span className="text-green-600 mt-0.5 text-lg">•</span>
                    <span className="flex-1">{strength}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Opportunities */}
        {recording.opportunities && recording.opportunities.length > 0 && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-600">
                <span>⚡</span>
                Growth Opportunities ({recording.opportunities.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recording.opportunities.map((opp, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg">
                    <span className="text-yellow-600 mt-0.5 text-lg">•</span>
                    <span className="flex-1">{opp}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Keywords */}
        {recording.keywords && Object.keys(recording.keywords).length > 0 && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle>Important Keywords</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {Object.entries(recording.keywords)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 15)
                  .map(([keyword, count]) => (
                    <Badge key={keyword} variant="secondary" className="text-sm px-3 py-1">
                      {keyword} <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">{count}</span>
                    </Badge>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Questions */}
        {recording.questions && recording.questions.length > 0 && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle>Questions Asked ({recording.questions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recording.questions.map((q, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-blue-600 mt-0.5 text-lg">Q:</span>
                    <span className="flex-1">{q}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Competitors */}
        {recording.competitors && recording.competitors.length > 0 && (
          <Card className="shadow-card mb-8">
            <CardHeader>
              <CardTitle>Competitors Mentioned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {recording.competitors.map((comp, i) => (
                  <Badge key={i} variant="outline">{comp}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full Transcript */}
        <Card className="shadow-card mb-8">
          <CardHeader>
            <CardTitle>Full Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {transcriptSegments.length > 0 ? (
                transcriptSegments.map((segment, index) => (
                  <div 
                    key={index} 
                    className={`p-3 rounded-lg border-l-4 ${getSpeakerColor(segment.speaker)} ${
                      containsQuestion(segment.text) ? 'ring-2 ring-yellow-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <Badge variant="secondary" className="font-semibold">
                        {segment.speaker}
                      </Badge>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {segment.emotion && (
                          <span className="px-2 py-1 bg-white rounded-full">
                            {segment.emotion}
                          </span>
                        )}
                        <span>{formatTime(segment.start)}</span>
                      </div>
                    </div>
                    <p className="text-sm">
                      {segment.text}
                    </p>
                    {containsQuestion(segment.text) && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-yellow-600">
                        <span>❓</span>
                        <span>Contains question</span>
                      </div>
                    )}
                  </div>
                ))
              ) : recording.transcript && recording.transcript.length > 0 ? (
                recording.transcript.map((line, index) => (
                  <p key={index} className="text-sm p-2 bg-gray-50 rounded">
                    {line}
                  </p>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No transcript available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Full Analysis */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>AI Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`prose prose-sm max-w-none ${!showFullAnalysis && 'max-h-48 overflow-hidden relative'}`}>
              <p className="whitespace-pre-wrap">{recording.geminiFullAnalysis}</p>
              {!showFullAnalysis && (
                <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white to-transparent"></div>
              )}
            </div>
            
            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={() => setShowFullAnalysis(!showFullAnalysis)}
            >
              {showFullAnalysis ? (
                <>
                  <ChevronUp className="mr-2 h-4 w-4" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-4 w-4" />
                  Read Full Analysis
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Analytics;