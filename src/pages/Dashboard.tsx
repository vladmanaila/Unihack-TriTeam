import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, BarChart3, Clock, TrendingUp, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { auth, db } from "../firebaseConfig";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import RealtimeCallModal from "@/components/RealtimeCallModal";

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

const Dashboard = () => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchUserRecordings(currentUser.uid);
      } else {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);
  const [showRecordingModal, setShowRecordingModal] = useState(false);

  const fetchUserRecordings = async (userId: string) => {
    try {
      setLoading(true);
      const recordingsRef = collection(db, "recordings");
      const q = query(
        recordingsRef, 
        where("userId", "==", userId),
        orderBy("date", "desc")
      );
      
      
      const querySnapshot = await getDocs(q);
      const userRecordings: Recording[] = [];
      
      querySnapshot.forEach((doc) => {
        userRecordings.push({
          id: doc.id,
          ...doc.data()
        } as Recording);
      });
      
      setRecordings(userRecordings);
    } catch (error) {
      console.error("Error fetching recordings:", error);
    } finally {
      setLoading(false);
    }
  };

  const getSentimentColor = (score: number) => {
    if (score >= 80) return "bg-secondary text-secondary-foreground";
    if (score >= 60) return "bg-primary text-primary-foreground";
    return "bg-muted text-muted-foreground";
  };

  const formatDate = (timestamp: Timestamp) => {
    return timestamp.toDate().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Calculate stats from recordings
  const totalRecordings = recordings.length;
  const avgSentiment = recordings.length > 0 
    ? Math.round(recordings.reduce((sum, rec) => sum + parseInt(rec.recordingStats.sentimentScoreAvg || "0"), 0) / recordings.length)
    : 0;
  
  // Calculate total hours (you might want to add duration to your recording structure)
  const totalHours = (recordings.length * 0.5).toFixed(1); // Mock calculation

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading your recordings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="bg-hero-gradient rounded-2xl p-8 mb-8 shadow-card-lg text-white">
          <h1 className="text-4xl font-bold mb-2">
            Welcome back{user?.displayName ? `, ${user.displayName}` : ''}!
          </h1>
          <p className="text-white/90 mb-6">Ready to coach your next sales call?</p>
          
          <div className="flex flex-wrap gap-4">
            <Button variant="hero" size="lg" className="bg-white text-primary hover:bg-white/90" onClick={() => setShowRecordingModal(true)}>
              <Mic className="mr-2" />
              Record Call
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Recordings</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalRecordings}</div>
              <p className="text-xs text-muted-foreground">Your recordings</p>
            </CardContent>
          </Card>
          
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg. Sentiment</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgSentiment}%</div>
              <p className="text-xs text-muted-foreground">Across all recordings</p>
            </CardContent>
          </Card>
          
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalHours}h</div>
              <p className="text-xs text-muted-foreground">Analyzed content</p>
            </CardContent>
          </Card>
        </div>

        {/* Recordings List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Recent Recordings</h2>
          </div>
          
          {recordings.length === 0 ? (
            <Card className="shadow-card text-center p-8">
              <CardContent>
                <Mic className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No recordings yet</h3>
                <p className="text-muted-foreground mb-4">
                  Start by recording your first sales call to see analytics here.
                </p>
                <Button>
                  <Mic className="mr-2" />
                  Record Your First Call
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {recordings.map((recording) => (
                <Card key={recording.id} className="shadow-card hover:shadow-card-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-1">{recording.title}</CardTitle>
                        <CardDescription className="flex items-center gap-4 text-sm">
                          <span>{formatDate(recording.date)}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {/* Add duration field to your recording structure if needed */}
                            N/A
                          </span>
                        </CardDescription>
                      </div>
                      <Link to={`/analytics/${recording.id}`}>
                        <Button variant="outline" size="sm">
                          View Full Analytics
                        </Button>
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Sentiment:</span>
                        <Badge className={getSentimentColor(parseInt(recording.recordingStats.sentimentScoreAvg || "0"))}>
                          {recording.recordingStats.sentimentScoreAvg || "0"}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Engagement:</span>
                        <Badge variant="outline">{recording.recordingStats.engagementPercentage || "0"}%</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Opportunities:</span>
                        <Badge variant="secondary" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {recording.recordingStats.missedOpportunitiesCount || "0"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Strengths:</span>
                        <Badge variant="outline">{recording.recordingStats.strengthsCount || "0"}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
          {showRecordingModal && (
    <RealtimeCallModal
      onComplete={() => {
        setShowRecordingModal(false);
        if (user) fetchUserRecordings(user.uid);
      }}
      onCancel={() => setShowRecordingModal(false)}
    />
  )}

    </div>
  );
};

export default Dashboard;