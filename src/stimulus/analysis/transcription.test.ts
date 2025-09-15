import { describe, it, expect } from 'vitest';
import { 
  AudioTranscriptionStimulus, 
  PodcastTranscriptionStimulus, 
  InterviewTranscriptionStimulus, 
  MeetingTranscriptionStimulus, 
  LectureTranscriptionStimulus 
} from './transcription.js';

describe('Transcription Stimuli', () => {
  describe('AudioTranscriptionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(AudioTranscriptionStimulus.id).toBe('audio-transcription');
      expect(AudioTranscriptionStimulus.name).toBe('Audio Transcription');
      expect(AudioTranscriptionStimulus.description).toContain('transcribe audio files');
    });

    it('should have correct role and objective', () => {
      expect(AudioTranscriptionStimulus.role).toBe('transcription agent and audio analyst');
      expect(AudioTranscriptionStimulus.objective).toBe('transcribe audio files with detailed metadata and analysis');
    });

    it('should have transcription specific instructions', () => {
      expect(AudioTranscriptionStimulus.instructions.some(i => i.includes('Transcribe audio content accurately'))).toBe(true);
      expect(AudioTranscriptionStimulus.instructions.some(i => i.includes('Identify speakers and timestamps'))).toBe(true);
      expect(AudioTranscriptionStimulus.instructions.some(i => i.includes('Categorize content segments'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(AudioTranscriptionStimulus.temperature).toBe(0.3);
      expect(AudioTranscriptionStimulus.maxTokens).toBe(2000);
      expect(AudioTranscriptionStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PodcastTranscriptionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PodcastTranscriptionStimulus.id).toBe('podcast-transcription');
      expect(PodcastTranscriptionStimulus.name).toBe('Podcast Transcription');
      expect(PodcastTranscriptionStimulus.description).toContain('transcribe podcast episodes');
    });

    it('should have correct role and objective', () => {
      expect(PodcastTranscriptionStimulus.role).toBe('podcast transcription specialist');
      expect(PodcastTranscriptionStimulus.objective).toBe('transcribe podcast episodes with comprehensive metadata');
    });

    it('should have podcast specific instructions', () => {
      expect(PodcastTranscriptionStimulus.instructions.some(i => i.includes('Transcribe podcast content'))).toBe(true);
      expect(PodcastTranscriptionStimulus.instructions.some(i => i.includes('Identify hosts, guests, and speakers'))).toBe(true);
      expect(PodcastTranscriptionStimulus.instructions.some(i => i.includes('Mark advertisement segments'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PodcastTranscriptionStimulus.temperature).toBe(0.3);
      expect(PodcastTranscriptionStimulus.maxTokens).toBe(2500);
      expect(PodcastTranscriptionStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('InterviewTranscriptionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(InterviewTranscriptionStimulus.id).toBe('interview-transcription');
      expect(InterviewTranscriptionStimulus.name).toBe('Interview Transcription');
      expect(InterviewTranscriptionStimulus.description).toContain('transcribe interviews');
    });

    it('should have correct role and objective', () => {
      expect(InterviewTranscriptionStimulus.role).toBe('interview transcription specialist');
      expect(InterviewTranscriptionStimulus.objective).toBe('transcribe interviews with comprehensive analysis');
    });

    it('should have interview specific instructions', () => {
      expect(InterviewTranscriptionStimulus.instructions.some(i => i.includes('Transcribe interview content'))).toBe(true);
      expect(InterviewTranscriptionStimulus.instructions.some(i => i.includes('Identify interviewer and interviewee'))).toBe(true);
      expect(InterviewTranscriptionStimulus.instructions.some(i => i.includes('Mark question and answer segments'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(InterviewTranscriptionStimulus.temperature).toBe(0.3);
      expect(InterviewTranscriptionStimulus.maxTokens).toBe(2000);
      expect(InterviewTranscriptionStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('MeetingTranscriptionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(MeetingTranscriptionStimulus.id).toBe('meeting-transcription');
      expect(MeetingTranscriptionStimulus.name).toBe('Meeting Transcription');
      expect(MeetingTranscriptionStimulus.description).toContain('transcribe meetings');
    });

    it('should have correct role and objective', () => {
      expect(MeetingTranscriptionStimulus.role).toBe('meeting transcription specialist');
      expect(MeetingTranscriptionStimulus.objective).toBe('transcribe meetings with comprehensive analysis');
    });

    it('should have meeting specific instructions', () => {
      expect(MeetingTranscriptionStimulus.instructions.some(i => i.includes('Transcribe meeting content'))).toBe(true);
      expect(MeetingTranscriptionStimulus.instructions.some(i => i.includes('Identify all participants and speakers'))).toBe(true);
      expect(MeetingTranscriptionStimulus.instructions.some(i => i.includes('Mark agenda items and discussion topics'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(MeetingTranscriptionStimulus.temperature).toBe(0.3);
      expect(MeetingTranscriptionStimulus.maxTokens).toBe(2000);
      expect(MeetingTranscriptionStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('LectureTranscriptionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(LectureTranscriptionStimulus.id).toBe('lecture-transcription');
      expect(LectureTranscriptionStimulus.name).toBe('Lecture Transcription');
      expect(LectureTranscriptionStimulus.description).toContain('transcribe lectures');
    });

    it('should have correct role and objective', () => {
      expect(LectureTranscriptionStimulus.role).toBe('educational transcription specialist');
      expect(LectureTranscriptionStimulus.objective).toBe('transcribe lectures with comprehensive analysis');
    });

    it('should have lecture specific instructions', () => {
      expect(LectureTranscriptionStimulus.instructions.some(i => i.includes('Transcribe lecture content'))).toBe(true);
      expect(LectureTranscriptionStimulus.instructions.some(i => i.includes('Identify instructor and students'))).toBe(true);
      expect(LectureTranscriptionStimulus.instructions.some(i => i.includes('Mark key concepts and topics'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(LectureTranscriptionStimulus.temperature).toBe(0.3);
      expect(LectureTranscriptionStimulus.maxTokens).toBe(2500);
      expect(LectureTranscriptionStimulus.getRunnerType()).toBe('base');
    });
  });
});
