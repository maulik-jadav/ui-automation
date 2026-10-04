import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { Shell } from "./components/Shell";
import { Home } from "./pages/Home";
import { Teach } from "./pages/Teach";
import { Library } from "./pages/Library";
import { ArtifactDetail } from "./pages/ArtifactDetail";
import { RunTask } from "./pages/RunTask";
import { HandoffInbox } from "./pages/HandoffInbox";
import { HandoffDetail } from "./pages/HandoffDetail";
import { Safety } from "./pages/Safety";
import { History } from "./pages/History";
import { RunDetail } from "./pages/RunDetail";
import { RunReport } from "./pages/RunReport";
import { TestLab } from "./pages/TestLab";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="teach" element={<Teach />} />
            <Route path="library" element={<Library />} />
            <Route path="library/:id" element={<ArtifactDetail />} />
            <Route path="run" element={<RunTask />} />
            <Route path="run/:runId" element={<RunTask />} />
            <Route path="handoff" element={<HandoffInbox />} />
            <Route path="handoff/:id" element={<HandoffDetail />} />
            <Route path="safety" element={<Safety />} />
            <Route path="history" element={<History />} />
            <Route path="history/:id" element={<RunDetail />} />
            <Route path="history/:id/report" element={<RunReport />} />
            <Route path="lab" element={<TestLab />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
