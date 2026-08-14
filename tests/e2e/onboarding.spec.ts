import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shows the bilingual community onboarding screen', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'harnessdesk-e2e-'))
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, HARNESSDESK_E2E: '1', HARNESSDESK_E2E_USER_DATA: userData },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.getByText('HarnessDesk').first()).toBeVisible()
    await window.getByRole('button', { name: 'EN' }).click()
    await expect(window.getByText(/not an official DeepSeek product/i)).toBeVisible()
    await window.getByRole('button', { name: '中文' }).click()
    await expect(window.getByText('社区桌面客户端')).toBeVisible()
    await window.screenshot({ path: 'test-results/onboarding.png', fullPage: true })
    const settingsUrl = new URL(window.url())
    settingsUrl.searchParams.set('view', 'vision')
    await window.goto(settingsUrl.href)
    await expect(window.getByText('本地视觉桥')).toBeVisible()
    await expect(window.locator('input:not([type="checkbox"])').first()).toHaveValue('http://127.0.0.1:1234/v1')
    await window.waitForTimeout(700)
    await window.screenshot({ path: 'test-results/vision-settings.png', fullPage: true })
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('packaged app starts its bundled Harness runtime', async () => {
  test.setTimeout(240_000)
  const executablePath = process.env.HARNESSDESK_PACKAGED_EXECUTABLE
  test.skip(executablePath === undefined, 'requires a packaged executable')
  const userData = await mkdtemp(join(tmpdir(), 'harnessdesk-packaged-e2e-'))
  await writeFile(join(userData, 'desktop-config.json'), JSON.stringify({
    schemaVersion: 1,
    locale: 'en',
    onboardingComplete: true,
    lastWorkspace: process.cwd(),
    windowBounds: { width: 1180, height: 780 },
    updateChecksEnabled: false,
  }))
  let first: Awaited<ReturnType<typeof electron.launch>> | undefined
  let second: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const launch = () => electron.launch({
      executablePath: executablePath!,
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, HARNESSDESK_E2E: '1', HARNESSDESK_E2E_USER_DATA: userData },
    })
    first = await launch()
    const firstWindow = await first.firstWindow()
    await firstWindow.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180_000 })
    expect(new URL(firstWindow.url()).hostname).toBe('127.0.0.1')
    expect((await readdir(join(userData, 'runtime-cache'))).some(name => name.startsWith('harness-'))).toBe(true)
    await first.close()
    first = undefined

    second = await launch()
    const secondWindow = await second.firstWindow()
    await secondWindow.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 45_000 })
    expect(new URL(secondWindow.url()).hostname).toBe('127.0.0.1')
    await second.close()
    second = undefined
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
  }
})
