import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Audio Transcription Stimulus
 * 
 * Tests models' ability to transcribe audio content with detailed metadata.
 * This evaluates:
 * - Audio content transcription accuracy
 * - Metadata extraction capabilities
 * - Structured data processing
 * - Content analysis and categorization
 */
export const AudioTranscriptionStimulus = new Stimulus({
  id: 'audio-transcription',
  name: 'Audio Transcription',
  description: 'Test models\' ability to transcribe audio files with detailed metadata',
  
  role: "transcription agent and audio analyst",
  objective: "transcribe audio files with detailed metadata and analysis",
  instructions: [
    "Transcribe audio content accurately",
    "Identify speakers and timestamps",
    "Categorize content segments (advertisements, interviews, etc.)",
    "Extract topics and themes from the content"
  ],
  output: [
    "Accurate transcription of spoken content",
    "Speaker identification and timestamps",
    "Content categorization and metadata",
    "Topic extraction and analysis"
  ],
  examples: [
    "Example: Transcribe a podcast episode with speaker identification and topic analysis"
  ],
  temperature: 0.3, // Lower temperature for more consistent transcription
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * Podcast Transcription Stimulus
 */
export const PodcastTranscriptionStimulus = new Stimulus({
  id: 'podcast-transcription',
  name: 'Podcast Transcription',
  description: 'Test models\' ability to transcribe podcast episodes with detailed analysis',
  
  role: "podcast transcription specialist",
  objective: "transcribe podcast episodes with comprehensive metadata",
  instructions: [
    "Transcribe podcast content with high accuracy",
    "Identify hosts, guests, and speakers",
    "Mark advertisement segments and sponsor content",
    "Extract discussion topics and themes"
  ],
  output: [
    "Complete podcast transcription",
    "Speaker identification and roles",
    "Advertisement and sponsor identification",
    "Topic analysis and discussion themes"
  ],
  examples: [
    "Example: Transcribe a tech podcast with host/guest identification and topic extraction"
  ],
  temperature: 0.3,
  maxTokens: 2500,
  runnerType: 'base'
});

/**
 * Interview Transcription Stimulus
 */
export const InterviewTranscriptionStimulus = new Stimulus({
  id: 'interview-transcription',
  name: 'Interview Transcription',
  description: 'Test models\' ability to transcribe interviews with detailed analysis',
  
  role: "interview transcription specialist",
  objective: "transcribe interviews with comprehensive analysis",
  instructions: [
    "Transcribe interview content accurately",
    "Identify interviewer and interviewee",
    "Mark question and answer segments",
    "Extract key insights and quotes"
  ],
  output: [
    "Complete interview transcription",
    "Question and answer identification",
    "Key insights and quotes extraction",
    "Interview topic and theme analysis"
  ],
  examples: [
    "Example: Transcribe a job interview with question/answer identification and key insights"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * Meeting Transcription Stimulus
 */
export const MeetingTranscriptionStimulus = new Stimulus({
  id: 'meeting-transcription',
  name: 'Meeting Transcription',
  description: 'Test models\' ability to transcribe meetings with detailed analysis',
  
  role: "meeting transcription specialist",
  objective: "transcribe meetings with comprehensive analysis",
  instructions: [
    "Transcribe meeting content accurately",
    "Identify all participants and speakers",
    "Mark agenda items and discussion topics",
    "Extract action items and decisions"
  ],
  output: [
    "Complete meeting transcription",
    "Participant identification and roles",
    "Agenda items and discussion topics",
    "Action items and decisions made"
  ],
  examples: [
    "Example: Transcribe a business meeting with participant identification and action items"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * Lecture Transcription Stimulus
 */
export const LectureTranscriptionStimulus = new Stimulus({
  id: 'lecture-transcription',
  name: 'Lecture Transcription',
  description: 'Test models\' ability to transcribe lectures with detailed analysis',
  
  role: "educational transcription specialist",
  objective: "transcribe lectures with comprehensive analysis",
  instructions: [
    "Transcribe lecture content accurately",
    "Identify instructor and students",
    "Mark key concepts and topics",
    "Extract educational content and structure"
  ],
  output: [
    "Complete lecture transcription",
    "Instructor and student identification",
    "Key concepts and topics",
    "Educational content structure and organization"
  ],
  examples: [
    "Example: Transcribe a university lecture with concept identification and educational structure"
  ],
  temperature: 0.3,
  maxTokens: 2500,
  runnerType: 'base'
});
