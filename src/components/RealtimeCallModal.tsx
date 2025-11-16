import React from 'react';
import { useSalesCoach } from '../hooks/useSalesCoach';
import { RecordingState } from '../../types';
import { MicIcon } from './icons';

interface RealtimeCallModalProps {
  onComplete: () => void;
  onCancel: () => void;
}

const RealtimeCallModal: React.FC<RealtimeCallModalProps> = ({ onComplete, onCancel }) => {
    const { 
        recordingState, 
        transcript, 
        realtimeFeedback, 
        error, 
        isSDKLoading,
        currentSpeaker,
        combinedSegments,
        startRecording, 
        stopRecording, 
        reset 
    } = useSalesCoach();

    const handleSaveAndFinish = () => {
        onComplete();
        reset();
        onCancel();
    };

    const handleCancel = () => {
        reset();
        onCancel();
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
                        <div className="mb-4 flex justify-center items-center gap-4">
                            <p className="text-center text-gray-500">Recording in progress...</p>
                            <div className="flex items-center gap-2 bg-blue-100 px-3 py-1 rounded-full">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                                <span className="text-sm font-medium text-blue-700">
                                    Speaking: {currentSpeaker || 'Detecting...'}
                                </span>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-96">
                            {/* Live Transcript with Emotions */}
                            <div className="bg-gray-50 p-4 rounded-lg overflow-y-auto border">
                                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                    <span>Live Transcript</span>
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
                                            Waiting for speech...
                                        </p>
                                    )}
                                </div>
                            </div>

                           {/* Real-time Feedback */}
                            <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg overflow-y-auto border border-gray-200 shadow-sm">
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
                                    </div>
                                    <h3 className="font-bold text-gray-800">
                                        AI Coach Feedback
                                    </h3>
                                </div>
                                <div className="space-y-3">
                                    {realtimeFeedback.map((fb, i) => {
                                        const lower = fb.toLowerCase();
                                        const isStrength = lower.includes('good') || lower.includes('strong') || 
                                                         lower.includes('excellent') || lower.includes('well done') ||
                                                         lower.includes('great') || lower.includes('praise');
                                        const isWarning = lower.includes('avoid') || lower.includes("don't") || 
                                                        lower.includes('stop') || lower.includes('never') ||
                                                        lower.includes('weak') || lower.includes('improve');
                                        
                                        const config = isStrength
                                            ? {
                                                  border: 'border-green-200',
                                                  bg: 'bg-gradient-to-r from-green-50 to-emerald-50',
                                                  icon: '🎯',
                                                  iconBg: 'bg-green-500',
                                                  textColor: 'text-green-900'
                                              }
                                            : isWarning
                                            ? {
                                                  border: 'border-amber-200',
                                                  bg: 'bg-gradient-to-r from-amber-50 to-orange-50',
                                                  icon: '⚠️',
                                                  iconBg: 'bg-amber-500',
                                                  textColor: 'text-amber-900'
                                              }
                                            : {
                                                  border: 'border-blue-200',
                                                  bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
                                                  icon: '💡',
                                                  iconBg: 'bg-blue-500',
                                                  textColor: 'text-blue-900'
                                              };
                                        
                                        return (
                                            <div
                                                key={i}
                                                className={`p-4 rounded-xl border-2 ${config.border} ${config.bg} transform transition-all duration-300 hover:scale-102 hover:shadow-md animate-in slide-in-from-right`}
                                                style={{ animationDelay: `${i * 100}ms` }}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`flex-shrink-0 w-8 h-8 ${config.iconBg} rounded-full flex items-center justify-center shadow-sm`}>
                                                        <span className="text-sm">{config.icon}</span>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`${config.textColor} text-sm leading-relaxed font-medium`}>
                                                            {fb}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {realtimeFeedback.length === 0 && (
                                        <div className="text-center py-12">
                                            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex items-center justify-center">
                                                <span className="text-2xl">💬</span>
                                            </div>
                                            <p className="text-gray-400 text-sm">
                                                AI feedback will appear here...
                                            </p>
                                            <p className="text-gray-300 text-xs mt-1">
                                                Start speaking to receive coaching tips
                                            </p>
                                        </div>
                                    )}
                                </div>
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
                    <div className="text-center py-12">
                        <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                            <MicIcon className="w-10 h-10 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">
                            Ready to Record
                        </h3>
                        <p className="text-gray-600 mb-4">
                            Click "Start Recording" to begin your sales call
                        </p>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto text-left">
                            <p className="text-sm text-blue-800 font-semibold mb-2">
                                What you'll get:
                            </p>
                            <ul className="text-sm text-blue-700 space-y-1">
                                <li>✓ Live transcript with speaker identification</li>
                                <li>✓ Real-time emotion and sentiment analysis</li>
                                <li>✓ Instant coaching feedback</li>
                                <li>✓ Complete analysis after call</li>
                            </ul>
                        </div>
                    </div>
                );
        }
    };
    
    const renderButtons = () => {
         switch (recordingState) {
            case RecordingState.IDLE:
                const isDisabled = !!error || isSDKLoading;
                const buttonText = isSDKLoading ? 'Initializing...' : 'Start Recording';
                return (
                    <button 
                        onClick={startRecording} 
                        disabled={isDisabled} 
                        className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition-all transform hover:scale-105"
                    >
                        <MicIcon className="w-5 h-5" />
                        <span>{buttonText}</span>
                    </button>
                );

            case RecordingState.RECORDING:
                return (
                    <button 
                        onClick={stopRecording} 
                        className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 shadow-lg transition-all transform hover:scale-105"
                    >
                        <div className="w-3 h-3 bg-white rounded-sm animate-pulse"></div>
                        <span>Stop Recording</span>
                    </button>
                );

            case RecordingState.DONE:
                return (
                    <button 
                        onClick={handleSaveAndFinish} 
                        className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-8 rounded-full shadow-lg transition-all transform hover:scale-105"
                    >
                        View Analytics Dashboard
                    </button>
                );

            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">AI Sales Coach</h2>
                        <p className="text-sm text-gray-600">Real-time analysis with emotion detection</p>
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
                        <p className="font-bold">Error</p>
                        <p className="text-sm">{error}</p>
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

export default RealtimeCallModal;