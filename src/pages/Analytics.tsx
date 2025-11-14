import { useParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, TrendingUp, TrendingDown, MessageSquare, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useState, useEffect } from "react";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

interface Recording {
  id: string;
  audioFileUrl: string;
  coachingCard: string[];
  date: Timestamp;
  sentimentGraph: string;
  title: string;
  transcript: string[];
  recordingStats: {
    engagementPercentage: string;
    missedOpportunitiesCount: string;
    sentimentScoreAvg: string;
    strengthsCount: string;
  };
  userId: string;
}

// Parse sentiment graph data from string to array
const parseSentimentData = (sentimentGraph: string) => {
  try {
    if (!sentimentGraph) return [];
    return JSON.parse(sentimentGraph);
  } catch (error) {
    console.error("Error parsing sentiment graph:", error);
    return [];
  }
};

// Parse transcript data
const parseTranscript = (transcript: string[]) => {
  if (!transcript || transcript.length === 0) return [];
  
  return transcript.map((text, index) => ({
    speaker: index % 2 === 0 ? "Sales Rep" : "Prospect",
    text: text,
    timestamp: `${Math.floor(index * 2)}:${(index * 2 % 1 * 60).toString().padStart(2, '0')}`
  }));
};

const Analytics = () => {
  const { id } = useParams();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecording = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const recordingDoc = await getDoc(doc(db, "recordings", id));
        
        if (recordingDoc.exists()) {
          setRecording({
            id: recordingDoc.id,
            ...recordingDoc.data()
          } as Recording);
        } else {
          console.error("Recording not found");
        }
      } catch (error) {
        console.error("Error fetching recording:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecording();
  }, [id]);

  const formatDate = (timestamp: Timestamp) => {
    return timestamp.toDate().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Recording not found</h1>
          <p className="text-muted-foreground">The recording you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const sentimentData = parseSentimentData(recording.sentimentGraph);
  const transcriptData = parseTranscript(recording.transcript);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{recording.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{formatDate(recording.date)}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {/* Add duration field if needed */}
                N/A
              </span>
            </div>
          </div>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Download Report
          </Button>
        </div>

        {/* Sentiment Chart */}
        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle>Sentiment Analysis Over Time</CardTitle>
            <CardDescription>Track emotional tone throughout the conversation</CardDescription>
          </CardHeader>
          <CardContent>
            {sentimentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={sentimentData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="sentiment" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No sentiment data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Coaching Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-secondary">
                <TrendingUp className="h-5 w-5" />
                Strengths ({recording.coachingCard?.filter((card: string) => card.startsWith('STRENGTH:')).length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recording.coachingCard?.filter((card: string) => card.startsWith('STRENGTH:')).length > 0 ? (
                recording.coachingCard
                  .filter((card: string) => card.startsWith('STRENGTH:'))
                  .map((card, index) => (
                    <div key={index} className="p-3 bg-secondary/10 rounded-lg border border-secondary/20">
                      <h4 className="font-semibold mb-1">{card.replace('STRENGTH:', '').trim()}</h4>
                      <p className="text-sm text-muted-foreground">Positive aspect identified in the conversation.</p>
                    </div>
                  ))
              ) : (
                <p className="text-muted-foreground text-center py-4">No strengths identified yet</p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-accent">
                <TrendingDown className="h-5 w-5" />
                Opportunities ({recording.coachingCard?.filter((card: string) => card.startsWith('OPPORTUNITY:')).length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recording.coachingCard?.filter((card: string) => card.startsWith('OPPORTUNITY:')).length > 0 ? (
                recording.coachingCard
                  .filter((card: string) => card.startsWith('OPPORTUNITY:'))
                  .map((card, index) => (
                    <div key={index} className="p-3 bg-accent/10 rounded-lg border border-accent/20">
                      <h4 className="font-semibold mb-1">{card.replace('OPPORTUNITY:', '').trim()}</h4>
                      <p className="text-sm text-muted-foreground">Area for improvement identified in the conversation.</p>
                    </div>
                  ))
              ) : (
                <p className="text-muted-foreground text-center py-4">No opportunities identified yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transcript */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Conversation Transcript
            </CardTitle>
            <CardDescription>Automatically transcribed with speaker identification</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {transcriptData.length > 0 ? (
                <>
                  {transcriptData.slice(0, 10).map((entry, index) => (
                    <div key={index} className="flex gap-3">
                      <Badge variant={entry.speaker === "Sales Rep" ? "default" : "secondary"} className="h-6 shrink-0">
                        {entry.speaker === "Sales Rep" ? "You" : "Prospect"}
                      </Badge>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-muted-foreground">{entry.timestamp}</span>
                        </div>
                        <p className="text-sm">{entry.text}</p>
                      </div>
                    </div>
                  ))}
                  {transcriptData.length > 10 && (
                    <>
                      <Separator />
                      <p className="text-sm text-muted-foreground text-center">
                        + {transcriptData.length - 10} more conversation exchanges
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-center py-4">No transcript available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Analytics;