import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import enhanceApp from './enhanceApp'
import './custom.css'

export default {
  ...DefaultTheme,
  enhanceApp
}
