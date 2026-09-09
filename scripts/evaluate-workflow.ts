import { readFile } from 'node:fs/promises'
import { evaluateWorkflow } from '../src/main/services/evaluation'

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file || process.argv.length !== 3) throw new Error('Usage: npm run evaluate:workflow -- <local-manifest.json>')
  const report = evaluateWorkflow(JSON.parse(await readFile(file, 'utf8')))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.candidateForReview) process.exitCode = 2
}

main().catch((error: unknown) => {
  process.stderr.write(`Evaluation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
