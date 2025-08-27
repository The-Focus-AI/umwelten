import React, { useState, useEffect } from 'react';
import { Box, Text, Spacer } from 'ink';
import { EvaluationConfig } from '../evaluation/api.js';

interface ModelProgress {
  modelName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  content: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

interface EvaluationUIProps {
  config: EvaluationConfig;
  onComplete: (results: any) => void;
}

const ModelStatus: React.FC<{ progress: ModelProgress }> = ({ progress }) => {
  const getStatusIcon = () => {
    switch (progress.status) {
      case 'pending':
        return '⏳';
      case 'in_progress':
        return '🔄';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
    }
  };

  const getElapsedTime = () => {
    if (!progress.startTime) return '';
    const endTime = progress.endTime || Date.now();
    const elapsed = Math.round((endTime - progress.startTime) / 1000);
    return ` (${elapsed}s)`;
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">{getStatusIcon()}</Text>
        <Text bold> {progress.modelName}</Text>
        <Text dimColor>{getElapsedTime()}</Text>
      </Box>
      
      {progress.status === 'error' && progress.error && (
        <Box marginLeft={2}>
          <Text color="red">Error: {progress.error}</Text>
        </Box>
      )}
      
      {progress.content && (
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>Response:</Text>
          <Box
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            paddingY={0}
            flexDirection="column"
          >
            {progress.content.split('\n').slice(0, 10).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {progress.content.split('\n').length > 10 && (
              <Text dimColor>... ({progress.content.split('\n').length - 10} more lines)</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

const ProgressBar: React.FC<{ current: number; total: number }> = ({ current, total }) => {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  
  return (
    <Box>
      <Text color="green">{bar}</Text>
      <Text> {percentage}% ({current}/{total})</Text>
    </Box>
  );
};

export const EvaluationUI: React.FC<EvaluationUIProps> = ({ config, onComplete }) => {
  const [modelProgress, setModelProgress] = useState<ModelProgress[]>(
    config.models.map(model => ({
      modelName: model,
      status: 'pending' as const,
      content: ''
    }))
  );
  const [startTime] = useState(Date.now());

  const updateModelProgress = (modelName: string, updates: Partial<ModelProgress>) => {
    setModelProgress(prev => prev.map(p => 
      p.modelName === modelName ? { ...p, ...updates } : p
    ));
  };

  const completedCount = modelProgress.filter(p => p.status === 'completed').length;
  const totalCount = modelProgress.length;
  const isComplete = completedCount === totalCount;

  useEffect(() => {
    // This would be called by the parent to update progress
    // For now, let's simulate the evaluation process
    const runEvaluation = async () => {
      for (let i = 0; i < config.models.length; i++) {
        const modelName = config.models[i];
        
        updateModelProgress(modelName, { 
          status: 'in_progress', 
          startTime: Date.now() 
        });
        
        // Simulate streaming response
        let content = '';
        const words = [
          'This', 'is', 'a', 'simulated', 'streaming', 'response', 'from', 'the', 'model.',
          'It', 'shows', 'how', 'content', 'would', 'appear', 'progressively', 'during', 'evaluation.'
        ];
        
        for (const word of words) {
          await new Promise(resolve => setTimeout(resolve, 200));
          content += word + ' ';
          updateModelProgress(modelName, { content: content.trim() });
        }
        
        updateModelProgress(modelName, { 
          status: 'completed',
          endTime: Date.now()
        });
      }
    };

    runEvaluation();
  }, [config.models]);

  useEffect(() => {
    if (isComplete) {
      setTimeout(() => onComplete(modelProgress), 1000);
    }
  }, [isComplete, modelProgress, onComplete]);

  const getOverallElapsed = () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    return `${elapsed}s`;
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="blue">🚀 Evaluation: {config.evaluationId}</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text dimColor>Prompt: {config.prompt}</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text>Progress: </Text>
        <ProgressBar current={completedCount} total={totalCount} />
      </Box>
      
      <Box flexDirection="column">
        {modelProgress.map(progress => (
          <ModelStatus key={progress.modelName} progress={progress} />
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>Elapsed: {getOverallElapsed()}</Text>
        <Spacer />
        {isComplete && <Text color="green" bold>✅ Evaluation Complete!</Text>}
      </Box>
    </Box>
  );
};