import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import PDFMaker from './pages/PDFMaker'
import Shrinker from './pages/Shrinker'

function App() {
  return (
    <Routes>
      <Route path="/tools" element={<Landing />} />
      <Route path="/tools/pdfmaker" element={<PDFMaker />} />
      <Route path="/tools/shrinker" element={<Shrinker />} />
      <Route path="/" element={<Navigate to="/tools" replace />} />
      <Route path="*" element={<Navigate to="/tools" replace />} />
    </Routes>
  )
}

export default App
