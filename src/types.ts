import React from 'react';

export enum RecordingState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  TRANSCRIBING = 'TRANSCRIBING', // Finished recording, user can review transcript
  ANALYZING = 'ANALYZING',
  DONE = 'DONE',
}

export interface EngagementDataPoint {
  time: string;
  engagement: number;
}

export interface SegmentedTranscript {
  segment: string;
  text: string;
}

export interface CoachingCard {
  whatWentWell: string[];
  missedOpportunities: string[];
}

export interface AnalysisResult {
  segmentedTranscript: SegmentedTranscript[];
  engagementAnalysis: EngagementDataPoint[];
  coachingCard: CoachingCard;
}

export interface Recording {
  id: string;
  title: string;
  company: string;
  date: string; // Should be ISO string format for Firestore compatibility
  duration: string;
  sentiment?: number;
  engagement?: number;
  opportunities?: number;
  transcript: string;
  analysis?: AnalysisResult;
}

export interface Stat {
  label: string;
  value: string;
  change: string;
  changeType: 'increase' | 'decrease' | 'none';
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}