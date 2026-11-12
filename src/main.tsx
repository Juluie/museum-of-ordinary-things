import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/onest'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/home.css'
import './styles/exhibit.css'
import './styles/form.css'
import './styles/admin.css'
import { App } from './App.tsx'
import { createApi } from './lib/api/index.ts'
import { AppContext } from './lib/app-context.ts'
import { readAppConfig } from './lib/config.ts'
import { ConfigErrorPage } from './pages/ConfigErrorPage.tsx'

const result = readAppConfig()
const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {result.ok ? (
      <AppContext.Provider value={{ config: result.config, api: createApi(result.config) }}>
        <App />
      </AppContext.Provider>
    ) : (
      <ConfigErrorPage problems={result.problems} />
    )}
  </StrictMode>,
)
