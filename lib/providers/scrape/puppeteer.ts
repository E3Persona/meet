import type { ScrapeProvider, ScrapeResult } from "./types"

// Returns raw page text (markdown-like) so blockSplitter can handle it.
// No HTML structure parsing here — that belongs in blockSplitter.
export function createPuppeteerProvider(): ScrapeProvider {
  return {
    name: "puppeteer",
    async scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult> {
      try {
        const puppeteerExtra = (await import("puppeteer-extra")).default
        const stealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default
        puppeteerExtra.use(stealthPlugin())

        const browser = await puppeteerExtra.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
          ],
        })

        const page = await browser.newPage()
        const timeout = opts?.timeout ?? 30000

        await page.setExtraHTTPHeaders({
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })

        await page.setViewport({ width: 1920, height: 1080 })

        const response = await page.goto(url, { waitUntil: "networkidle2", timeout })

        const status = response?.status() ?? 0
        if (status === 403 || status === 503) {
          const bodyText = await page.evaluate(() => document.body?.innerText ?? "")
          if (isCloudflareChallenge(bodyText)) {
            await browser.close()
            return { markdown: null, error: `Cloudflare challenge (HTTP ${status})` }
          }
        }

        // Wait for any remaining JS to settle
        await page.waitForTimeout(2000)

        // Extract plain text — heading/list structure for block splitter
        const text = await page.evaluate(() => {
          const body = document.body
          if (!body) return ""

          const clone = body.cloneNode(true) as HTMLElement
          for (const el of clone.querySelectorAll("script,style,noscript,iframe,svg")) {
            el.remove()
          }

          const lines: string[] = []
          const selectors = "h1,h2,h3,h4,h5,h6,li,p,div,article,section"
          for (const el of clone.querySelectorAll<HTMLElement>(selectors)) {
            const content = el.innerText?.trim() ?? ""
            if (!content) continue
            const tag = el.tagName.toLowerCase()

            if (tag === "h1") lines.push(`\n# ${content}\n`)
            else if (tag === "h2") lines.push(`\n## ${content}\n`)
            else if (tag === "h3") lines.push(`\n### ${content}\n`)
            else if (tag === "h4" || tag === "h5" || tag === "h6") lines.push(`\n#### ${content}\n`)
            else if (tag === "li") lines.push(`- ${content}`)
            else if (tag === "p") lines.push(content)
            else if (content.length > 80) lines.push(content)
          }

          return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
        })

        await browser.close()
        return { markdown: text || null }
      } catch (err) {
        return { markdown: null, error: String(err) }
      }
    },
  }
}

function isCloudflareChallenge(text: string): boolean {
  const markers = [
    "checking your browser",
    "just a moment",
    "enable javascript and cookies",
    "cloudflare",
    "attention required",
    "turnstile",
    "ray id",
  ]
  const lower = text.toLowerCase()
  return markers.some((m) => lower.includes(m))
}
