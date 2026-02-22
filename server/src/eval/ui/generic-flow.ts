// Generic UI flow: heuristic-based testing for any web app
import type { Page } from 'playwright';
import type { FlowStep } from './runner';

// Primary action button selectors (heuristic)
const PRIMARY_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button.primary',
  'button.btn-primary',
  '[data-testid="submit"]',
  '[data-testid="primary-action"]',
  'button:has-text("Login")',
  'button:has-text("登录")',
  'button:has-text("Sign")',
  'button:has-text("Start")',
  'button:has-text("开始")',
  'button:has-text("Create")',
  'button:has-text("创建")',
  'button:has-text("Search")',
  'button:has-text("搜索")',
  'button:has-text("Submit")',
  'button:has-text("提交")',
  'button:has-text("Go")',
  'button:has-text("Enter")',
];

// Navigation link selectors
const NAV_SELECTORS = [
  'nav a',
  'header a',
  '[role="navigation"] a',
  '.nav a',
  '.navbar a',
  '.menu a',
  '.sidebar a',
];

export function getGenericFlow(): FlowStep[] {
  return [
    // Step 1: Navigate to homepage
    { action: 'navigate', target: '/' },

    // Step 2: Wait for page to load
    { action: 'wait', target: 'body' },

    // Step 3: Take homepage screenshot
    { action: 'screenshot', value: '01-homepage' },

    // Step 4: Check for main content
    { action: 'check_element', target: 'main, #root, #app, .app, [role="main"], body > div' },
  ];
}

export async function findPrimaryButton(page: Page): Promise<string | null> {
  for (const selector of PRIMARY_BUTTON_SELECTORS) {
    try {
      const element = await page.$(selector);
      if (element && await element.isVisible()) {
        return selector;
      }
    } catch {
      // Selector not found, continue
    }
  }
  return null;
}

export async function findNavigationLinks(page: Page, maxLinks: number = 3): Promise<string[]> {
  const links: string[] = [];

  for (const navSelector of NAV_SELECTORS) {
    try {
      const elements = await page.$$(navSelector);
      for (const el of elements) {
        if (links.length >= maxLinks) break;

        const href = await el.getAttribute('href');
        const isVisible = await el.isVisible();

        // Skip external links, anchors, and javascript links
        if (href && isVisible &&
            !href.startsWith('http') &&
            !href.startsWith('#') &&
            !href.startsWith('javascript:') &&
            href !== '/') {
          links.push(href);
        }
      }
      if (links.length >= maxLinks) break;
    } catch {
      // Continue with next selector
    }
  }

  return links;
}

export async function buildDynamicFlow(page: Page, baseUrl: string): Promise<FlowStep[]> {
  const steps: FlowStep[] = [...getGenericFlow()];

  // Try to find and click primary button
  const primaryButton = await findPrimaryButton(page);
  if (primaryButton) {
    steps.push({ action: 'screenshot', value: '02-before-primary-click' });
    steps.push({ action: 'click', target: primaryButton });
    steps.push({ action: 'wait', target: 'body' });
    steps.push({ action: 'screenshot', value: '03-after-primary-click' });
  }

  // Navigate to top links
  const navLinks = await findNavigationLinks(page);
  for (let i = 0; i < navLinks.length; i++) {
    steps.push({ action: 'navigate', target: navLinks[i] });
    steps.push({ action: 'wait', target: 'body' });
    steps.push({ action: 'screenshot', value: `04-nav-${i + 1}` });
  }

  // Final screenshot
  steps.push({ action: 'screenshot', value: '99-final' });

  return steps;
}

export interface GenericFlowConfig {
  testPrimaryButton: boolean;
  testNavigation: boolean;
  maxNavLinks: number;
}

export const DEFAULT_FLOW_CONFIG: GenericFlowConfig = {
  testPrimaryButton: true,
  testNavigation: true,
  maxNavLinks: 3,
};
