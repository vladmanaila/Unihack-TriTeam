import React, { useRef } from 'react';
import { useFileUploadSalesCoach } from '../hooks/useFileUploadSalesCoach';
import { RecordingState } from '../../types';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, X, CheckCircle2, AlertCircle, FileAudio } from "lucide-react";

interface FileUploadCallModalProps {
  onComplete: () => void;
  onCancel: () => void;
}

const FileUploadCallModal: React.FC<FileUploadCallModalProps> = ({ onComplete, onCancel }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { 
        recordingState, 
        error, 
        uploadProgress,
        uploadAndAnalyzeFile, 
        reset 
    } = useFileUploadSalesCoach();

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            uploadAndAnalyzeFile(file);
        }
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) {
            uploadAndAnalyzeFile(file);
        }
    };

    const handleCancel = () => {
        reset();
        onCancel();
    };

    const handleComplete = () => {
        onComplete();
        reset();
    };

    const renderContent = () => {
        switch (recordingState) {
            case RecordingState.RECORDING:
            case RecordingState.ANALYZING:
                return (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-4"></div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">
                            {recordingState === RecordingState.RECORDING ? 'Processing Audio File...' : 'Analyzing Conversation...'}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {recordingState === RecordingState.RECORDING 
                                ? 'Transcribing audio and identifying speakers...' 
                                : 'Gemini Pro is analyzing the conversation with context'
                            }
                        </p>
                        
                        <div className="max-w-md mx-auto">
                            <Progress value={uploadProgress} className="h-2 mb-4" />
                            <p className="text-sm text-gray-500">{uploadProgress}% complete</p>
                        </div>

                        <div className="mt-6 space-y-2 text-sm text-gray-500">
                            <p>✓ Processing audio quality</p>
                            <p>✓ Transcribing conversation</p>
                            <p>✓ Identifying speakers</p>
                            <p>✓ Analyzing emotional patterns</p>
                            <p>✓ Evaluating communication effectiveness</p>
                            <p>✓ Generating coaching insights</p>
                        </div>
                    </div>
                );

            case RecordingState.DONE:
                return (
                    <div className="text-center py-12">
                        <div className="text-6xl mb-4">🎉</div>
                        <h3 className="text-2xl font-bold text-gray-800 mb-2">
                            Analysis Complete!
                        </h3>
                        <p className="text-gray-600 mb-6">
                            Your recording has been saved with full analytics
                        </p>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                            <p className="text-sm text-green-800">
                                ✓ Audio saved to database<br/>
                                ✓ Transcript with emotions generated<br/>
                                ✓ Speaker identification complete<br/>
                                ✓ AI coaching insights ready<br/>
                                ✓ All analytics data stored
                            </p>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="text-center py-8">
                        <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                            <Upload className="w-10 h-10 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">
                            Upload Sales Call Recording
                        </h3>
                        <p className="text-gray-600 mb-6">
                            Upload an audio file to analyze with AI coaching
                        </p>
                        
                        {/* File Drop Zone */}
                        <div
                            className="border-2 border-dashed border-gray-300 rounded-2xl p-8 mb-6 hover:border-blue-500 transition-colors cursor-pointer"
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <FileAudio className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-lg font-semibold text-gray-700 mb-2">
                                Drop your audio file here
                            </p>
                            <p className="text-gray-500 text-sm">
                                or click to browse files
                            </p>
                            <p className="text-gray-400 text-xs mt-4">
                                Supports MP3, WAV, M4A, OGG, WEBM (max 100MB)
                            </p>
                        </div>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            accept="audio/*"
                            className="hidden"
                        />

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto text-left">
                            <p className="text-sm text-blue-800 font-semibold mb-2">
                                What you'll get:
                            </p>
                            <ul className="text-sm text-blue-700 space-y-1">
                                <li>✓ Complete transcript with speaker identification</li>
                                <li>✓ Emotion and sentiment analysis</li>
                                <li>✓ Coaching insights and recommendations</li>
                                <li>✓ Strengths and opportunities identified</li>
                                <li>✓ Keywords and questions extracted</li>
                                <li>✓ Full analytics dashboard</li>
                            </ul>
                        </div>
                    </div>
                );
        }
    };

    const renderButtons = () => {
        switch (recordingState) {
            case RecordingState.IDLE:
                return (
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 bg-blue-600 hover:bg-blue-700"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            Select File
                        </Button>
                    </div>
                );

            case RecordingState.RECORDING:
            case RecordingState.ANALYZING:
                return (
                    <Button
                        onClick={handleCancel}
                        variant="outline"
                        className="w-full"
                        disabled={true}
                    >
                        Processing... {uploadProgress}%
                    </Button>
                );

            case RecordingState.DONE:
                return (
                    <Button
                        onClick={handleComplete}
                        className="w-full bg-green-600 hover:bg-green-700"
                    >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        View Analytics Dashboard
                    </Button>
                );

            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Upload Call Analysis</h2>
                        <p className="text-sm text-gray-600">AI-powered sales conversation analysis</p>
                    </div>
                    <button 
                        onClick={handleCancel} 
                        className="text-gray-400 hover:text-gray-600 text-3xl font-bold transition-colors"
                    >
                        &times;
                    </button>
                </div>
                
                {error && (
                    <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 m-6 rounded" role="alert">
                        <div className="flex items-center">
                            <AlertCircle className="w-5 h-5 mr-2" />
                            <p className="font-bold">Error</p>
                        </div>
                        <p className="text-sm mt-1">{error}</p>
                    </div>
                )}

                <div className="overflow-y-auto p-6 flex-grow">
                    {renderContent()}
                </div>

                <div className="flex justify-center p-6 border-t bg-gray-50">
                    {renderButtons()}
                </div>
            </div>
        </div>
    );
};

export default FileUploadCallModal;