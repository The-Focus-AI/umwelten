import { defineConfig } from 'vitepress'
import { searchConfig } from './search.config'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Umwelten",
  description: "A command-line tool to interact with and systematically evaluate AI models across providers",
  base: '/',
  ignoreDeadLinks: true, // Temporarily ignore dead links while we build out documentation
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
    // Custom theme for enhanced search
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Walkthroughs', link: '/walkthroughs/' },
      { text: 'Migration', link: '/migration/' },
      { text: 'API', link: '/api/overview' }
    ],

    // Search configuration
    search: searchConfig,

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Basic Usage', link: '/guide/basic-usage' },
            { text: 'Search Documentation', link: '/guide/search' }
          ]
        },
        {
          text: 'Core Features',
          items: [
            { text: 'Model Discovery', link: '/guide/model-discovery' },
            { text: 'Running Prompts', link: '/guide/running-prompts' },
            { text: 'Interactive Chat', link: '/guide/interactive-chat' },
            { text: 'Telegram Bot', link: '/guide/telegram-bot' },
            { text: 'Jeeves Bot', link: '/guide/jeeves-bot' },
            { text: 'Web Interface', link: '/guide/web' },
            { text: 'Tool Calling', link: '/guide/tool-calling' },
            { text: 'Model Evaluation', link: '/guide/model-evaluation' },
            { text: 'Structured Output', link: '/guide/structured-output' },
            { text: 'Batch Processing', link: '/guide/batch-processing' }
          ]
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Code Execution', link: '/guide/code-execution' },
            { text: 'Concurrent Processing', link: '/guide/concurrent-processing' },
            { text: 'Cost Analysis', link: '/guide/cost-analysis' },
            { text: 'Reports & Analysis', link: '/guide/reports' },
            { text: 'Memory & Tools', link: '/guide/memory-tools' },
            { text: 'Session Management & Search', link: '/guide/session-management' },
            { text: 'Context Management', link: '/guide/context-management' }
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Basic Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Simple Text Generation', link: '/examples/text-generation' },
            { text: 'Creative Writing', link: '/examples/creative-writing' },
            { text: 'Analysis & Reasoning', link: '/examples/analysis-reasoning' },
            { text: 'Tool Integration', link: '/examples/tool-integration' }
          ]
        },
        {
          text: 'Code & Execution',
          items: [
            { text: 'Code Execution', link: '/examples/code-execution-examples' },
            { text: 'Tool Conversations', link: '/examples/tool-conversation-examples' },
            { text: 'Reasoning & Streaming', link: '/examples/reasoning-streaming-examples' }
          ]
        },
        {
          text: 'Image Processing',
          items: [
            { text: 'Basic Image Analysis', link: '/examples/image-analysis' },
            { text: 'Structured Image Features', link: '/examples/image-features' },
            { text: 'Batch Image Processing', link: '/examples/image-batch' }
          ]
        },
        {
          text: 'Document Processing',
          items: [
            { text: 'PDF Analysis', link: '/examples/pdf-analysis' },
            { text: 'Multi-format Documents', link: '/examples/multi-format' }
          ]
        },
        {
          text: 'Advanced Workflows',
          items: [
            { text: 'Multi-language Evaluation', link: '/examples/multi-language' },
            { text: 'Complex Structured Output', link: '/examples/complex-structured' },
            { text: 'Cost Optimization', link: '/examples/cost-optimization' }
          ]
        }
      ],
      '/walkthroughs/': [
        {
          text: 'Practical Walkthroughs',
          items: [
            { text: 'Overview', link: '/walkthroughs/' },
            { text: 'Session Analysis Walkthrough', link: '/walkthroughs/session-analysis-walkthrough' },
            { text: 'TRMNL Project Analysis', link: '/walkthroughs/trmnl-project-analysis' }
          ]
        }
      ],
      '/migration/': [
        {
          text: 'Script Migration',
          items: [
            { text: 'Overview', link: '/migration/' },
            { text: 'Migration Guide', link: '/migration/guide' },
            { text: 'Completed Migrations', link: '/migration/completed' },
            { text: 'Migration Status', link: '/migration/status' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'TypeScript API',
          items: [
            { text: 'Overview', link: '/api/overview' },
            { text: 'Cognition Module', link: '/api/cognition' },
            { text: 'Interaction', link: '/api/interaction' },
            { text: 'Providers', link: '/api/providers' },
            { text: 'Memory', link: '/api/memory' },
            { text: 'Tools', link: '/api/tools' },
            { text: 'CLI', link: '/api/cli' },
            { text: 'Core Classes', link: '/api/core-classes' },
            { text: 'Model Integration', link: '/api/model-integration' },
            { text: 'Evaluation Framework', link: '/api/evaluation-framework' },
            { text: 'Schema Validation', link: '/api/schemas' }
          ]
        },
        {
          text: 'Advanced Integration',
          items: [
            { text: 'MCP Implementation Guide', link: '/MCP_IMPLEMENTATION_SUMMARY' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/The-Focus-AI/umwelten' }
    ],

    editLink: {
      pattern: 'https://github.com/The-Focus-AI/umwelten/edit/main/docs/:path'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 The Focus AI'
    },

    // Additional search features
    outline: {
      level: [2, 3],
      label: 'On this page'
    },

    docFooter: {
      prev: 'Previous page',
      next: 'Next page'
    },

    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium'
      }
    }
  }
})
