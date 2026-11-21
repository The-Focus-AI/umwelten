import type { EnhanceAppContext } from 'vitepress'

export default ({ app }: EnhanceAppContext) => {
  // Add global search keyboard shortcut
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const searchButton = document.querySelector('.VPNavBarSearch .DocSearch-Button') as HTMLElement
        if (searchButton) {
          searchButton.click()
        }
      }
      
      // Escape to close search
      if (e.key === 'Escape') {
        const searchModal = document.querySelector('.DocSearch-Modal')
        if (searchModal) {
          const closeButton = searchModal.querySelector('.DocSearch-Cancel') as HTMLElement
          if (closeButton) {
            closeButton.click()
          }
        }
      }
    })
  }

  // Add search analytics (optional)
  app.provide('searchAnalytics', {
    trackSearch: (query: string, results: number) => {
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'search', {
          search_term: query,
          results_count: results
        })
      }
    }
  })
}
