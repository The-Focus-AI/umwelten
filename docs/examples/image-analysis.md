# Basic Image Analysis

This example shows how to analyze images using Umwelten's vision-capable models. This corresponds to the migrated `image-parsing.ts` script functionality.

## Simple Image Analysis

### Basic Image Description

Analyze a single image across multiple vision models:

```bash
npx umwelten eval run \
  --prompt "Analyze this image and provide a summary of the content." \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest,ollama:gemma3:12b" \
  --id "image-analysis" \
  --attach "./input/images/test-image.jpg" \
  --concurrent
```

### Detailed Analysis with Specific Questions

Ask specific questions about image content:

```bash
npx umwelten eval run \
  --prompt "What objects do you see in this image? Describe the colors, lighting, and overall mood." \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "detailed-image-analysis" \
  --attach "./path/to/image.png"
```

### Text Recognition in Images

Test OCR capabilities:

```bash
npx umwelten eval run \
  --prompt "Extract and transcribe any text visible in this image. If no text is present, describe what you see instead." \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "text-extraction" \
  --attach "./document-photo.jpg"
```

## Comparative Analysis

### Compare Vision Models

Test different vision models on the same image:

```bash
npx umwelten eval run \
  --prompt "Describe this image in detail, including objects, colors, composition, and any notable features." \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b,ollama:qwen2.5vl:latest" \
  --id "vision-model-comparison" \
  --attach "./test-image.jpg" \
  --concurrent
```

### Generate Comprehensive Report

```bash
# Create detailed markdown report
npx umwelten eval report --id vision-model-comparison --format markdown

# Export HTML report with embedded images
npx umwelten eval report --id vision-model-comparison --format html --output vision-report.html
```

## Interactive Mode

### Real-time Image Analysis

Watch models analyze images in real-time:

```bash
npx umwelten eval run \
  --prompt "Provide a detailed artistic analysis of this image, including composition, color theory, and emotional impact." \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "artistic-analysis" \
  --attach "./artwork.jpg" \
  --ui
```

## Advanced Image Prompts

### Scene Understanding

```bash
npx umwelten eval run \
  --prompt "Analyze this scene: What's happening? Who are the people? What's the setting? What time of day might it be?" \
  --models "google:gemini-2.0-flash" \
  --id "scene-understanding" \
  --attach "./scene-photo.jpg"
```

### Technical Analysis

```bash
npx umwelten eval run \
  --prompt "Analyze this image from a photography perspective: lighting, composition, depth of field, and technical quality." \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "photo-technical-analysis" \
  --attach "./photograph.jpg" \
  --concurrent
```

### Safety and Content Analysis

```bash
npx umwelten eval run \
  --prompt "Analyze this image for content appropriateness and describe any safety concerns or notable elements." \
  --models "google:gemini-2.0-flash" \
  --id "content-safety-analysis" \
  --attach "./user-upload.jpg"
```

## Expected Output Examples

### Basic Image Analysis Results

**Google Gemini 2.0 Flash**
```
This image shows a bustling city street during what appears to be late afternoon. The scene includes:

- Multiple pedestrians walking on sidewalks
- Several cars and a bus in the street
- Tall buildings with glass facades reflecting sunlight
- Street lamps beginning to illuminate as daylight fades
- A few street vendors with small stalls
- Clear blue sky with some clouds visible between buildings

The lighting suggests golden hour photography, creating warm tones across the urban landscape. The composition captures the energy and movement of city life.
```

**Ollama qwen2.5vl:latest**
```
I can see an urban street scene with the following elements:

Objects visible:
- Cars (sedan, SUV, taxi)
- People walking
- Buildings (office buildings, storefronts)
- Traffic lights and street signs
- Trees lining the sidewalk

The image has warm lighting conditions, likely taken during late afternoon. The overall mood is busy and energetic, typical of a commercial district during rush hour. The perspective appears to be taken from street level, showing both the pedestrian and vehicular activity.
```

## Performance Comparison Report

### Sample Report Output

```markdown
# Image Analysis Report: vision-model-comparison

**Generated:** 2025-01-27T14:20:00.000Z  
**Image:** test-image.jpg
**Total Models:** 3

| Model | Provider | Response Length | Tokens (P/C/Total) | Time (ms) | Cost Estimate |
|-------|----------|----------------|-------------------|-----------|---------------|
| gemini-2.0-flash | google | 485 | 12/122/134 | 3200 | $0.000041 |
| gemini-1.5-flash-8b | google | 390 | 12/98/110 | 2800 | $0.000033 |
| qwen2.5vl:latest | ollama | 425 | 12/107/119 | 4100 | Free |

## Analysis Summary

- **Most Detailed**: Google Gemini 2.0 Flash provided the most comprehensive analysis
- **Fastest**: Google Gemini 1.5 Flash 8B completed in 2.8 seconds
- **Most Cost-Effective**: Ollama qwen2.5vl:latest (free local processing)
- **Best Value**: Google Gemini 2.0 Flash offers excellent detail at low cost

## Vision Capabilities Observed

- **Object Recognition**: All models successfully identified main objects
- **Color Analysis**: Google models provided more detailed color descriptions
- **Spatial Reasoning**: Strong performance across all models for layout understanding
- **Text Recognition**: Google models showed superior OCR capabilities
```

## Model Capabilities Comparison

| Feature | Gemini 2.0 Flash | Gemini 1.5 Flash 8B | Qwen2.5VL | Notes |
|---------|------------------|---------------------|-----------|-------|
| Object Detection | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | All models perform well |
| Text Recognition (OCR) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Google models excel |
| Color Analysis | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Gemini provides detailed color descriptions |
| Artistic Analysis | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | All handle composition and style |
| Speed | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 1.5 Flash 8B is fastest |
| Cost | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Ollama is free, Google is affordable |

## Tips for Image Analysis

### Model Selection
- **Google Gemini 2.0 Flash**: Best overall performance, excellent for detailed analysis
- **Google Gemini 1.5 Flash 8B**: Fastest and cheapest Google option
- **Ollama qwen2.5vl**: Free local processing, good for privacy-sensitive content

### Prompt Design
- Be specific about what aspects you want analyzed
- Ask for structured output when you need consistent formatting
- Include context about the image's purpose or source when relevant

### File Formats
- Supported: JPEG, PNG, WebP, GIF
- Optimal: High-resolution images for better detail recognition
- Consider file size for faster processing

## Next Steps

- Try [structured image features](/examples/image-features) for extracting specific data
- Explore [batch image processing](/examples/image-batch) for multiple images
- See [PDF analysis](/examples/pdf-analysis) for document processing