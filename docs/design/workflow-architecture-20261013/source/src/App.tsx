import { Header } from './components/layout/Header';
import { WorkflowOverview } from './components/workflow/WorkflowOverview';
export default function App() {
  return <div className="architecture-app"><Header/><main className="architecture-main"><WorkflowOverview/></main></div>;
}
