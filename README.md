# CallCoach.ai

## CallCoach.ai is an intelligent sales call coaching platform built to transform the way sales teams learn, perform, and improve.


## Problem

Every day, companies miss opportunities for one simple reason:
There is no quick and objective way to analyze the quality of a sales call.

Managers don’t have time to listen to every call, reps don’t get real-time feedback, and progress is hard to measure.
Calls pile up, information gets lost, and performance stagnates.

## Solution

Sales Clarity Suite uses generative AI to automatically analyze any sales call — converted to text — and generate clear, actionable feedback.

## Why is it valuable?

- Sales reps receive instant feedback right after every call.
- Managers can track team progress without manual effort.
- Training becomes personalized, automated, and based on real data.
- Conversation quality is constantly increasing.

## Technologies

-Google Gemini 2.0 Flash API
-Azure Cognitive Services - Speech SDK
-Firebase Storage
-Firebase Firestore
-MediaRecorder API

## Real-Time Processing Pipeline

Microphone Audio Stream
    ↓
Azure (Speech-to-Text)
    ↓
Text + Speaker ID + Timestamps
    ↓
Gemini API Analysis
    ↓ 
Emotion + Sentiment + Coaching
    ↓
React UI Updates (live)


## How it works?

1. Record Your Call 🎤
Click "Start Recording" in your browser—no downloads, no complex setup.
2. AI Listens & Transcribes 📝
Azure Speech SDK converts speech to text in real-time and identifies who's speaking (you vs. customer).
3. Smart Analysis Happens Live 🧠
Google Gemini AI analyzes the conversation as it flows, detecting emotions, sentiment, and communication patterns.
4. Get Instant Coaching 📊
Receive live feedback during the call plus a detailed report after:

✅ What you did well
⚠️ What to improve
📈 Key metrics (talk ratio, sentiment score, engagement)