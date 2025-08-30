// Search configuration for VitePress
export const searchConfig = {
  provider: 'local' as const,
  options: {
    // Search through headings, content, and custom fields
    searchableFields: ['title', 'content', 'headings'],
    // Include code blocks in search
    includeCodeBlocks: true,
    // Search through frontmatter
    includeFrontmatter: true,
    // Enable fuzzy search
    fuzzy: true,
    // Search result limit
    maxResults: 20,
    // Custom search function for better relevance
    searchFunction: (query: string, pages: any[]) => {
      const results = pages.filter(page => {
        const searchableText = [
          page.title,
          page.content,
          ...(page.headings || []).map((h: any) => h.text),
          ...(page.frontmatter?.keywords || [])
        ].join(' ').toLowerCase()
        
        return searchableText.includes(query.toLowerCase())
      })
      
      // Sort by relevance (exact matches first)
      return results.sort((a, b) => {
        const aScore = getRelevanceScore(query, a)
        const bScore = getRelevanceScore(query, b)
        return bScore - aScore
      })
    },
    locales: {
      root: {
        translations: {
          button: {
            buttonText: 'Search documentation',
            buttonAriaLabel: 'Search documentation'
          },
          modal: {
            noResultsText: 'No results for',
            resetButtonTitle: 'Clear search',
            footer: {
              selectText: 'to select',
              navigateText: 'to navigate',
              closeText: 'to close'
            }
          }
        }
      }
    }
  }
}

// Helper function for search relevance scoring
function getRelevanceScore(query: string, page: any): number {
  const queryLower = query.toLowerCase()
  let score = 0
  
  // Title matches get highest score
  if (page.title?.toLowerCase().includes(queryLower)) {
    score += 10
  }
  
  // Exact title match gets bonus
  if (page.title?.toLowerCase() === queryLower) {
    score += 5
  }
  
  // Heading matches get good score
  if (page.headings) {
    const headingMatches = page.headings.filter((h: any) => 
      h.text.toLowerCase().includes(queryLower)
    ).length
    score += headingMatches * 3
  }
  
  // Content matches get base score
  if (page.content?.toLowerCase().includes(queryLower)) {
    score += 1
  }
  
  // Frontmatter keyword matches
  if (page.frontmatter?.keywords) {
    const keywordMatches = page.frontmatter.keywords.filter((k: string) =>
      k.toLowerCase().includes(queryLower)
    ).length
    score += keywordMatches * 2
  }
  
  return score
}
