import { useState } from 'react'
import { Command } from '@tauri-apps/plugin-shell'
import './App.css'

function App() {
  const [output, setOutput] = useState('Ready')
  const [isRunning, setIsRunning] = useState(false)

  const runRcloneVersion = async () => {
    setIsRunning(true)
    setOutput('Running `rclone version`...')

    try {
      const result = await Command.sidecar('binaries/rclone', ['version']).execute()
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()

      setOutput(stdout || stderr || `Exited with code ${result.code}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        <p className="eyebrow">Tauri Sidecar Check</p>
        <h1>Run `rclone version`</h1>
        <p className="description">
          Calls the binary placed in <code>src-tauri/binaries/</code> via
          Tauri&apos;s sidecar mechanism.
        </p>

        <button className="run-button" onClick={runRcloneVersion} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run sidecar'}
        </button>

        <div className="output-panel">
          <p className="output-label">Output</p>
          <pre>{output}</pre>
        </div>
      </section>
    </main>
  )
}

export default App
