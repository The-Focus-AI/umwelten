import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { EnhancedEvaluationConfig, EvaluationProgress, runEvaluationWithProgress } from '../evaluation/api.js';

interface ModelProgress {
  modelName: string;
  status: 'pending' | 'starting' | 'streaming' | 'completed' | 'error';
  content: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

interface EvaluationAppProps {
  config: EnhancedEvaluationConfig;
  onComplete: (results: any) => void;
  onError: (error: Error) => void;
}

const ModelStatus: React.FC<{ progress: ModelProgress }> = ({ progress }) => {
  const getStatusIcon = () => {
    switch (progress.status) {
      case 'pending':
        return '⏳';
      case 'starting':
        return '🔄';
      case 'streaming':
        return '📝';
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

  const getStatusText = () => {
    switch (progress.status) {
      case 'pending':
        return 'Pending...';
      case 'starting':
        return 'Starting...';
      case 'streaming':
        return 'Generating response...';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Failed';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">{getStatusIcon()}</Text>
        <Text bold> {progress.modelName}</Text>
        <Text dimColor> - {getStatusText()}</Text>
        <Text dimColor>{getElapsedTime()}</Text>
      </Box>
      
      {progress.status === 'error' && progress.error && (
        <Box marginLeft={2}>
          <Text color="red">Error: {progress.error}</Text>
        </Box>
      )}
      
      {progress.content && (progress.status === 'streaming' || progress.status === 'completed') && (
        <Box marginLeft={2} flexDirection="column">
          <Box
            borderStyle="single"
            borderColor={progress.status === 'completed' ? 'green' : 'yellow'}
            paddingX={1}
            paddingY={0}
            flexDirection="column"
          >
            {progress.content.split('\n').slice(0, 8).map((line, i) => (
              <Text key={i}>{line.length > 80 ? line.substring(0, 77) + '...' : line}</Text>
            ))}
            {progress.content.split('\n').length > 8 && (
              <Text dimColor>... (truncated, {progress.content.length} total chars)</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

const ProgressBar: React.FC<{ current: number; total: number }> = ({ current, total }) => {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * 30);
  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
  
  return (
    <Box>
      <Text color="green">[{bar}]</Text>
      <Text> {percentage}% ({current}/{total})</Text>
    </Box>
  );
};

export const EvaluationApp: React.FC<EvaluationAppProps> = ({ config, onComplete, onError }) => {
  const [modelProgress, setModelProgress] = useState<ModelProgress[]>(
    config.models.map(model => ({
      modelName: model,
      status: 'pending' as const,
      content: ''
    }))
  );
  const [startTime] = useState(Date.now());
  const [isComplete, setIsComplete] = useState(false);

  const updateModelProgress = (update: EvaluationProgress) => {
    setModelProgress(prev => prev.map(p => {
      if (p.modelName === update.modelName || `${p.modelName}` === update.modelName) {
        const updates: Partial<ModelProgress> = { status: update.status };
        
        if (update.content) updates.content = update.content;
        if (update.error) updates.error = update.error;
        if (update.status === 'starting') updates.startTime = Date.now();
        if (update.status === 'completed' || update.status === 'error') updates.endTime = Date.now();
        
        return { ...p, ...updates };
      }
      return p;
    }));
  };

  const completedCount = modelProgress.filter(p => p.status === 'completed' || p.status === 'error').length;
  const totalCount = modelProgress.length;

  useEffect(() => {
    if (completedCount === totalCount && completedCount > 0 && !isComplete) {
      setIsComplete(true);
      setTimeout(() => {
        onComplete({
          evaluationId: config.evaluationId,
          results: modelProgress,
          totalTime: Date.now() - startTime
        });
      }, 1500); // Give user time to see final state
    }
  }, [completedCount, totalCount, isComplete, config.evaluationId, modelProgress, startTime, onComplete]);

  useEffect(() => {
    const runEvaluation = async () => {
      try {
        const enhancedConfig = {
          ...config,
          onProgress: updateModelProgress
        };
        
        await runEvaluationWithProgress(enhancedConfig);
      } catch (error) {
        onError(error as Error);
      }
    };

    runEvaluation();
  }, [config]);

  const getOverallElapsed = () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    return `${elapsed}s`;
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="blue">🚀 Evaluation: </Text>
        <Text bold color="white">{config.evaluationId}</Text>
      </Box>
      
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text dimColor>Prompt: </Text>
          <Text>{config.prompt}</Text>
        </Box>
        {config.systemPrompt && (
          <Box>
            <Text dimColor>System: </Text>
            <Text>{config.systemPrompt}</Text>
          </Box>
        )}
      </Box>
      
      <Box marginBottom={1}>
        <ProgressBar current={completedCount} total={totalCount} />
      </Box>
      
      <Box flexDirection="column">
        {modelProgress.map(progress => (
          <ModelStatus key={progress.modelName} progress={progress} />
        ))}
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>Elapsed: {getOverallElapsed()}</Text>
        <Box marginLeft={4}>
          {isComplete && (
            <Box>
              <Text color="green" bold>✅ Evaluation Complete!</Text>
              <Text dimColor> Press Ctrl+C to exit</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};