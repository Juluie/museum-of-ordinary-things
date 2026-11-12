import { BrowserRouter, Route, Routes } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { AboutPage } from './pages/AboutPage.tsx'
import { AdminLoginPage } from './pages/AdminLoginPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { ExhibitPage } from './pages/ExhibitPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { PrivacyPage } from './pages/PrivacyPage.tsx'
import { RandomExhibitPage } from './pages/RandomExhibitPage.tsx'
import { SubmitPage } from './pages/SubmitPage.tsx'
import { SubmittedPage } from './pages/SubmittedPage.tsx'

export function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/exhibit" element={<RandomExhibitPage />} />
        <Route path="/exhibit/:id" element={<ExhibitPage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/submitted" element={<SubmittedPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
