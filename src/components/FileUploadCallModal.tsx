import React, { useState, useRef } from 'react';
import { useFileUploadSalesCoach } from '@/hooks/useFileUploadSalesCoach';
import { RecordingState } from '../../types';

interface FileUploadCallModalProps {
  onComplete: () => void;
  onCancel: () => void;
}

const FileUploadCallModal: React.FC<FileUploadCallModalProps> = ({ onComplete, onCancel }) => {
    const { 
        recordingState, 
        transcript, 
        realtimeFeedback, 
        error, 
        isSDKLoading,
        currentSpeaker,
        uploadProgress,
        combinedSegments,
        uploadAndAnalyzeFile, 
        reset 
    } = useFileUploadSalesCoach();

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSaveAndFinish = () => {
        onComplete();
        reset();
        onCancel();
    };

    const handleCancel = () => {
        reset();
        setSelectedFile(null);
        onCancel();
    };

    const handleFileSelect = (file: File) => {
        setSelectedFile(file);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleUploadClick = () => {
        if (selectedFile) {
            uploadAndAnalyzeFile(selectedFile);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const getEmotionColor = (emotion?: string) => {
        switch(emotion?.toLowerCase()) {
            case 'joy':
            case 'enthusiasm':
            case 'confidence':
                return 'bg-green-100 border-green-300 text-green-800';
            case 'calm':
            case 'neutral':
                return 'bg-blue-100 border-blue-300 text-blue-800';
            case 'nervousness':
            case 'concern':
                return 'bg-yellow-100 border-yellow-300 text-yellow-800';
            case 'anger':
            case 'frustration':
                return 'bg-red-100 border-red-300 text-red-800';
            case 'sadness':
            case 'boredom':
                return 'bg-gray-100 border-gray-300 text-gray-800';
            default:
                return 'bg-gray-50 border-gray-200 text-gray-700';
        }
    };

    const getSentimentIcon = (sentiment?: string) => {
        switch(sentiment?.toLowerCase()) {
            case 'positive':
                return '😊';
            case 'negative':
                return '😟';
            case 'neutral':
            default:
                return '😐';
        }
    };

    const renderContent = () => {
        switch (recordingState) {
            case RecordingState.RECORDING:
                return (
                    <>
                        <div className="mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-gray-700 font-medium">
                                    Analyzing: {selectedFile?.name}
                                </p>
                                <div className="flex items-center gap-2 bg-blue-100 px-3 py-1 rounded-full">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                    <span className="text-sm font-medium text-blue-700">
                                        {currentSpeaker ? `Speaking: ${currentSpeaker}` : 'Processing...'}
                                    </span>
                                </div>
                            </div>
                            
                            {/* Progress Bar */}
                            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden mb-1">
                                <div 
                                    className="bg-gradient-to-r from-blue-500 to-purple-600 h-full transition-all duration-500 ease-out rounded-full"
                                    style={{ width: `${uploadProgress}%` }}
                                ></div>
                            </div>
                            <p className="text-sm text-gray-500 text-right">{uploadProgress}%</p>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-96">
                            {/* Live Transcript with Emotions */}
                            <div className="bg-gray-50 p-4 rounded-lg overflow-y-auto border">
                                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                    <span>Transcript</span>
                                    <span className="text-xs text-gray-500">with emotions</span>
                                </h3>
                                <div className="space-y-3">
                                    {combinedSegments.slice(-10).map((segment, i) => (
                                        <div 
                                            key={i} 
                                            className={`p-3 rounded-lg border-l-4 ${getEmotionColor(segment.emotion)}`}
                                        >
                                            <div className="flex items-start justify-between mb-1">
                                                <span className="font-semibold text-sm">
                                                    {segment.speaker}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    {segment.emotion && (
                                                        <span className="text-xs px-2 py-0.5 bg-white rounded-full">
                                                            {segment.emotion}
                                                        </span>
                                                    )}
                                                    {segment.sentiment && (
                                                        <span className="text-sm">
                                                            {getSentimentIcon(segment.sentiment)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-sm">{segment.text}</p>
                                        </div>
                                    ))}
                                    {combinedSegments.length === 0 && (
                                        <p className="text-gray-400 text-center py-8">
                                            Processing audio file...
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Real-time Feedback */}
                            <div className="bg-gray-50 p-4 rounded-lg overflow-y-auto border">
                                <h3 className="font-bold text-gray-800 mb-3">
                                    AI Coach Feedback
                                </h3>
                                <ul className="space-y-2">
                                    {realtimeFeedback.map((fb, i) => {
                                        const isPraise = fb.toLowerCase().includes('praise') || fb.toLowerCase().includes('great') || fb.toLowerCase().includes('excellent');
                                        return (
                                            <li 
                                                key={i} 
                                                className={`text-sm p-3 rounded-lg ${
                                                    isPraise 
                                                        ? 'bg-green-50 border-l-4 border-green-500 text-green-900' 
                                                        : 'bg-yellow-50 border-l-4 border-yellow-500 text-yellow-900'
                                                }`}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <span className="text-lg">
                                                        {isPraise ? '✅' : '💡'}
                                                    </span>
                                                    <span>{fb}</span>
                                                </div>
                                            </li>
                                        );
                                    })}
                                    {realtimeFeedback.length === 0 && (
                                        <p className="text-gray-400 text-center py-8">
                                            AI feedback will appear here...
                                        </p>
                                    )}
                                </ul>
                            </div>
                        </div>
                    </>
                );

            case RecordingState.ANALYZING:
                return (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-4"></div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">
                            Analyzing Complete Recording...
                        </h3>
                        <p className="text-gray-600">
                            Gemini Pro is analyzing the full conversation with context
                        </p>
                        <div className="mt-6 space-y-2 text-sm text-gray-500">
                            <p>✓ Processing audio quality</p>
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
                                ✓ Audio saved<br/>
                                ✓ Transcript with emotions generated<br/>
                                ✓ Speaker identification complete<br/>
                                ✓ AI coaching insights ready
                            </p>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="py-8">
                        {!selectedFile ? (
                            <>
                                {/* Drag & Drop Area */}
                                <div 
                                    className={`border-3 border-dashed rounded-2xl p-12 text-center transition-all ${
                                        isDragging 
                                            ? 'border-blue-500 bg-blue-50' 
                                            : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50'
                                    }`}
                                    onDrop={handleDrop}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                >
                                    <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                    </div>
                                    
                                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                                        Upload Sales Call Recording
                                    </h3>
                                    <p className="text-gray-600 mb-6">
                                        Drag & drop your audio file here, or click to browse
                                    </p>
                                    
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
                                        onChange={handleFileInputChange}
                                        className="hidden"
                                    />
                                    
                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-all transform hover:scale-105"
                                    >
                                        Browse Files
                                    </button>
                                    
                                    <div className="mt-6 text-sm text-gray-500">
                                        <p>Supported formats: MP3, WAV, M4A, OGG, WebM</p>
                                        <p>Maximum file size: 100MB</p>
                                    </div>
                                </div>

                                {/* Features Info */}
                                <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
                                    <p className="text-sm text-blue-800 font-semibold mb-3">
                                        What you'll get:
                                    </p>
                                    <ul className="text-sm text-blue-700 space-y-2">
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-500 mt-0.5">✓</span>
                                            <span>Full transcript with speaker identification (A, B, C...)</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-500 mt-0.5">✓</span>
                                            <span>Real-time emotion and sentiment analysis per segment</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-500 mt-0.5">✓</span>
                                            <span>AI-powered coaching feedback and suggestions</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-blue-500 mt-0.5">✓</span>
                                            <span>Complete analysis with communication metrics</span>
                                        </li>
                                    </ul>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Selected File Display */}
                                <div className="bg-white border-2 border-blue-200 rounded-xl p-6 mb-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-800 text-lg mb-1">
                                                    {selectedFile.name}
                                                </h4>
                                                <p className="text-sm text-gray-500">
                                                    {formatFileSize(selectedFile.size)} • {selectedFile.type || 'audio file'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedFile(null)}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-sm text-green-600 mb-4">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span>File ready for analysis</span>
                                    </div>

                                    <button
                                        onClick={handleUploadClick}
                                        disabled={isSDKLoading}
                                        className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-[1.02] disabled:bg-gray-400 disabled:cursor-not-allowed disabled:transform-none"
                                    >
                                        {isSDKLoading ? 'Initializing AI...' : 'Start Analysis'}
                                    </button>
                                </div>

                                {/* What happens next */}
                                <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
                                    <p className="text-sm font-semibold text-gray-800 mb-3">
                                        Analysis Process:
                                    </p>
                                    <div className="space-y-3 text-sm text-gray-700">
                                        <div className="flex items-start gap-3">
                                            <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
                                            <span>Audio transcription with speaker diarization</span>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
                                            <span>Emotion and sentiment detection for each segment</span>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
                                            <span>AI coaching feedback generation</span>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">4</span>
                                            <span>Complete analysis and metrics calculation</span>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                );
        }
    };

    const renderButtons = () => {
        if (recordingState === RecordingState.DONE) {
            return (
                <button 
                    onClick={handleSaveAndFinish} 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-8 rounded-full shadow-lg transition-all transform hover:scale-105"
                >
                    View Analytics Dashboard
                </button>
            );
        }
        return null;
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">AI Sales Coach</h2>
                        <p className="text-sm text-gray-600">Upload and analyze your sales calls</p>
                    </div>
                    <button 
                        onClick={handleCancel} 
                        className="text-gray-400 hover:text-gray-600 text-3xl font-bold transition-colors"
                        disabled={recordingState === RecordingState.RECORDING || recordingState === RecordingState.ANALYZING}
                    >
                        &times;
                    </button>
                </div>
                
                {error && (
                    <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 m-6 rounded" role="alert">
                        <p className="font-bold">Error</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                <div className="overflow-y-auto p-6 flex-grow">
                    {renderContent()}
                </div>

                {renderButtons() && (
                    <div className="flex justify-center p-6 border-t bg-gray-50">
                        {renderButtons()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FileUploadCallModal;