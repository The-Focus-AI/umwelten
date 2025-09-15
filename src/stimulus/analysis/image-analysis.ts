import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Image Analysis Stimulus
 * 
 * Tests models' ability to analyze images and extract information.
 * This evaluates:
 * - Visual comprehension and analysis
 * - Object detection and identification
 * - Scene understanding
 * - Text extraction from images
 * - Aesthetic and compositional analysis
 */
export const ImageAnalysisStimulus = new Stimulus({
  id: 'image-analysis',
  name: 'Image Analysis',
  description: 'Test models\' ability to analyze images and extract comprehensive information',
  
  role: "expert image analyst",
  objective: "analyze images and provide detailed, structured information",
  instructions: [
    "Analyze the image content thoroughly and systematically",
    "Identify all visible objects, people, and elements",
    "Describe the scene, setting, and context",
    "Extract any text visible in the image",
    "Analyze composition, lighting, and aesthetic qualities",
    "Provide confidence levels for your observations"
  ],
  output: [
    "Comprehensive description of visual content",
    "Object identification and classification",
    "Scene and context analysis",
    "Text extraction (if present)",
    "Aesthetic and compositional analysis",
    "Confidence assessments for key observations"
  ],
  examples: [
    "Example: Analyze a screenshot of a website and extract the title, navigation elements, and main content areas"
  ],
  temperature: 0.2, // Lower temperature for more consistent analysis
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * Image Feature Extraction Stimulus
 */
export const ImageFeatureExtractionStimulus = new Stimulus({
  id: 'image-feature-extraction',
  name: 'Image Feature Extraction',
  description: 'Test models\' ability to extract structured features from images',
  
  role: "computer vision specialist",
  objective: "extract structured features and metadata from images",
  instructions: [
    "Analyze the image systematically for specific features",
    "Extract color palette, aesthetic style, and composition",
    "Identify time of day, scene type, and environmental factors",
    "Detect text content and readability",
    "Assess image quality and technical characteristics",
    "Provide confidence scores for each feature"
  ],
  output: [
    "Color palette analysis (warm, cool, monochrome, etc.)",
    "Aesthetic style classification (realistic, cartoon, abstract, etc.)",
    "Time of day detection (day, night, unknown)",
    "Scene type classification (indoor, outdoor, unknown)",
    "Text presence and readability assessment",
    "Image quality and technical analysis",
    "Confidence scores for all features"
  ],
  examples: [
    "Example: Extract features from a product photo including color palette, style, and text content"
  ],
  temperature: 0.1, // Very low temperature for consistent feature extraction
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Image Object Detection Stimulus
 */
export const ImageObjectDetectionStimulus = new Stimulus({
  id: 'image-object-detection',
  name: 'Image Object Detection',
  description: 'Test models\' ability to identify and locate objects in images',
  
  role: "computer vision expert",
  objective: "identify and locate objects within images",
  instructions: [
    "Scan the image systematically for all visible objects",
    "Identify each object with high confidence",
    "Describe the location and spatial relationships",
    "Classify objects by category and type",
    "Assess object visibility and clarity",
    "Provide bounding box estimates where possible"
  ],
  output: [
    "Complete list of identified objects",
    "Object categories and classifications",
    "Spatial relationships and positions",
    "Visibility and clarity assessments",
    "Confidence levels for each detection",
    "Bounding box estimates (if applicable)"
  ],
  examples: [
    "Example: Identify all objects in a kitchen scene including appliances, furniture, and food items"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Image Text Extraction Stimulus
 */
export const ImageTextExtractionStimulus = new Stimulus({
  id: 'image-text-extraction',
  name: 'Image Text Extraction',
  description: 'Test models\' ability to extract and transcribe text from images',
  
  role: "OCR specialist and text extraction expert",
  objective: "extract and transcribe all text visible in images",
  instructions: [
    "Carefully scan the image for all text content",
    "Transcribe text accurately, preserving formatting",
    "Identify different text elements (headings, body text, captions, etc.)",
    "Note text styling, size, and positioning",
    "Handle different fonts, orientations, and languages",
    "Provide confidence levels for text accuracy"
  ],
  output: [
    "Complete transcription of all visible text",
    "Text element classification and hierarchy",
    "Styling and formatting information",
    "Language identification",
    "Confidence scores for text accuracy",
    "Notes on difficult-to-read text"
  ],
  examples: [
    "Example: Extract all text from a document screenshot including headers, body text, and footnotes"
  ],
  temperature: 0.1, // Very low temperature for accurate text extraction
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * Image Aesthetic Analysis Stimulus
 */
export const ImageAestheticAnalysisStimulus = new Stimulus({
  id: 'image-aesthetic-analysis',
  name: 'Image Aesthetic Analysis',
  description: 'Test models\' ability to analyze aesthetic and compositional qualities of images',
  
  role: "art critic and visual design expert",
  objective: "analyze aesthetic and compositional qualities of images",
  instructions: [
    "Analyze the visual composition and design elements",
    "Assess color harmony, contrast, and balance",
    "Evaluate lighting, mood, and atmosphere",
    "Identify artistic techniques and styles",
    "Consider emotional impact and visual appeal",
    "Provide professional aesthetic critique"
  ],
  output: [
    "Compositional analysis (rule of thirds, balance, etc.)",
    "Color theory assessment (harmony, contrast, mood)",
    "Lighting and atmosphere evaluation",
    "Artistic style and technique identification",
    "Emotional impact and visual appeal assessment",
    "Professional aesthetic critique and recommendations"
  ],
  examples: [
    "Example: Analyze the aesthetic qualities of a landscape photograph including composition, lighting, and mood"
  ],
  temperature: 0.3,
  maxTokens: 1500,
  runnerType: 'base'
});
