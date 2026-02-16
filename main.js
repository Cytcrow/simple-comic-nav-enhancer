// ==UserScript==
// @name         A Simple Web Navigation Enhancer
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  You can quickly access the previous and next episodes, perform smooth scrolling up or down, and even enable or disable full-screen mode. This script is designed to enhance the reading experience of web content in a more convenient and customizable.
// @match        https://westmanga.me/*
// @match        https://v1.komikcast.fit/*
// @match        https://aquareader.net/*
// @match        https://www.webtoons.com/*
// @match        https://kiryuu03.com/*
// @match        https://mangaku.lat/*
// @match        https://manhwatop.com/*
// @match        https://komiku.org/*
// @match        https://www.mikoroku.com/*
// @grant        none
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ========================
    // CONFIGURABLE KEY BINDINGS
    // ========================
    // Change these to customize your keybinds.
    // Each action accepts an array of key names (case-insensitive, matched against event.key).
    const KEY_BINDINGS = {
        scrollUp: ['w'],
        scrollDown: ['s'],
        prevChapter: ['a', 'ArrowLeft'],
        nextChapter: ['d', 'ArrowRight'],
        fullscreen: ['f'],
        allChapters: ['q'],
    };

    // ========================
    // SCROLL SETTINGS
    // ========================
    // All values are time-based (per second), so scroll speed is consistent
    // regardless of frame rate or page rendering load.
    const SCROLL_CONFIG = {
        maxSpeed: 1800,  // Maximum scroll speed (px per second)
        decayRate: 18,     // Momentum decay rate — higher = stops faster (per second, exponential)
        accelRate: 1500,   // Acceleration when key is held (px per second²)
    };

    // ========================
    // SITE CONFIGURATIONS
    // ========================
    // Per-site options:
    //   next / prev        — CSS selector for chapter navigation buttons
    //   allChapters        — CSS selector for the "all chapters" / series page link
    //   scrollSpeed        — Speed multiplier for this site (default: 1.0). Increase if scrolling feels slow.
    //   scrollContainer    — CSS selector for a nested scrollable element. If omitted, scrolls the window.
    const HOSTS = {
        'westmanga.me': {
            next: 'div.max-w-screen-xl:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > button:nth-child(2)',
            prev: 'div.max-w-screen-xl:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > button:nth-child(1)',
            allChapters: '.text-primary'
        },
        'v1.komikcast.fit': {
            next: 'button.hover\:bg-accent:nth-child(6)',
            prev: '.md\:gap-5 > button:nth-child(1)',
            allChapters: 'a.text-foreground',
            scrollContainer: 'div.flex-col:nth-child(2)'
        },
        'www.webtoons.com': {
            next: '.paginate .pg_next',
            prev: '.paginate .pg_prev',
            allChapters: '.subj_info .subj'
        },
        'aquareader.net': {
            next: 'a.btn.next_page',
            prev: 'a.btn.prev_page',
            allChapters: '.breadcrumb > li:nth-child(2) > a:nth-child(1)'
        },
        'kiryuu03.com': {
            next: 'a.justify-center:nth-child(3)',
            prev: 'a.px-4:nth-child(1)',
            allChapters: 'button.ring-offset-accent'
        },
        'mangaku.lat': {
            prev: 'button.glho.glkp_1:-soup-contains("PREV")',
            next: 'button.glho.glkn_1:-soup-contains("NEXT")'
        },
        'manhwatop.com': {
            prev: '.prev_page',
            next: '.next_page',
            allChapters: 'ol.breadcrumb li:nth-child(2) a'
        },
        'komiku.org': {
            prev: 'div.nxpr > a.rl:first-of-type',
            next: 'div.nxpr > a.rl:last-of-type',
            allChapters: 'div.perapih:nth-child(3) > div:nth-child(1) > div:nth-child(1) > a:nth-child(1)'
        },
        'www.mikoroku.com': {
            prev: 'a[rel="prev"][type="button"]',
            next: 'a[rel="next"][type="button"]',
            allChapters: 'a[rel="home"][type="button"]'
        }
    };

    // ========================
    // INITIALIZATION
    // ========================
    const host = window.location.host;
    const siteConfig = HOSTS[host];

    if (!siteConfig) {
        console.warn(`[NavEnhancer] No configuration found for host: "${host}". Script will not run.`);
        return;
    }

    const btnNext = siteConfig.next;
    const btnPrev = siteConfig.prev;
    const btnAllChapters = siteConfig.allChapters || null;
    const scrollSpeed = siteConfig.scrollSpeed || 1.0;
    const scrollContainerSelector = siteConfig.scrollContainer || null;

    // Force scroll-behavior: auto on the page to prevent the browser's
    // built-in smooth scrolling from interfering with our scroll engine.
    const styleOverride = document.createElement('style');
    styleOverride.textContent = 'html, body { scroll-behavior: auto !important; }';
    document.head.appendChild(styleOverride);

    let isFullscreen = false;
    let scrollingUp = false;
    let scrollingDown = false;
    let speedUp = 0;          // Current upward scroll speed (px/s)
    let speedDown = 0;        // Current downward scroll speed (px/s)
    let scrollRAF = null;     // requestAnimationFrame ID
    let lastFrameTime = null; // Timestamp of the last animation frame

    // ========================
    // HELPER FUNCTIONS
    // ========================

    /**
     * Checks if the user is currently focused on a text input field.
     * Prevents keybinds from firing while typing.
     */
    function isUserTyping() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    /**
     * Checks if a key matches one of the configured bindings for an action.
     * Comparison is case-insensitive for letter keys.
     */
    function isKeyMatch(pressedKey, actionKeys) {
        const lower = pressedKey.toLowerCase();
        return actionKeys.some(k => k.toLowerCase() === lower || k === pressedKey);
    }

    /**
     * Safely queries a DOM element by selector and clicks it.
     * Logs a warning if the selector is defined but no element is found.
     */
    function safeClick(selector, actionName) {
        if (!selector) {
            console.warn(`[NavEnhancer] No selector configured for "${actionName}" on ${host}.`);
            return;
        }
        const el = document.querySelector(selector);
        if (el) {
            el.click();
        } else {
            console.warn(`[NavEnhancer] "${actionName}" button not found with selector: "${selector}"`);
        }
    }

    // ========================
    // SCROLLING ENGINE (requestAnimationFrame + delta-time)
    // ========================
    // Uses real elapsed time to calculate scroll distance, making
    // speed consistent regardless of frame rate or rendering load.

    /**
     * Returns the scroll target element.
     * If a scrollContainer selector is configured for this site, returns that element.
     * Otherwise returns null (meaning we scroll the window).
     */
    function getScrollTarget() {
        if (scrollContainerSelector) {
            const container = document.querySelector(scrollContainerSelector);
            if (container) return container;
            console.warn(`[NavEnhancer] Scroll container "${scrollContainerSelector}" not found, falling back to window.`);
        }
        return null;
    }

    function scrollLoop(timestamp) {
        if (lastFrameTime === null) lastFrameTime = timestamp;
        const dt = (timestamp - lastFrameTime) / 1000; // Delta time in seconds
        lastFrameTime = timestamp;

        // Build or decay speed for each direction
        if (scrollingUp) {
            speedUp = Math.min(speedUp + SCROLL_CONFIG.accelRate * dt, SCROLL_CONFIG.maxSpeed);
        } else {
            speedUp *= Math.exp(-SCROLL_CONFIG.decayRate * dt);
        }

        if (scrollingDown) {
            speedDown = Math.min(speedDown + SCROLL_CONFIG.accelRate * dt, SCROLL_CONFIG.maxSpeed);
        } else {
            speedDown *= Math.exp(-SCROLL_CONFIG.decayRate * dt);
        }

        // Stop the loop when both speeds are negligible
        if (speedUp < 1 && speedDown < 1 && !scrollingUp && !scrollingDown) {
            scrollRAF = null;
            lastFrameTime = null;
            speedUp = 0;
            speedDown = 0;
            return;
        }

        // Apply net scroll (distance = speed × time × site multiplier)
        const netSpeed = speedDown - speedUp;
        const scrollDelta = netSpeed * dt * scrollSpeed;

        const target = getScrollTarget();
        if (target) {
            target.scrollTop += scrollDelta;
        } else {
            window.scrollBy(0, scrollDelta);
        }

        scrollRAF = requestAnimationFrame(scrollLoop);
    }

    function startScrolling(direction) {
        if (direction === 'up' && scrollingUp) return;
        if (direction === 'down' && scrollingDown) return;

        if (direction === 'up') scrollingUp = true;
        if (direction === 'down') scrollingDown = true;

        // Only start a new loop if one isn't already running
        if (!scrollRAF) {
            lastFrameTime = null;
            scrollRAF = requestAnimationFrame(scrollLoop);
        }
    }

    function stopScrolling(direction) {
        if (direction === 'up') scrollingUp = false;
        if (direction === 'down') scrollingDown = false;
    }

    // ========================
    // FULLSCREEN
    // ========================

    function toggleFullscreen() {
        if (!isFullscreen) {
            const elem = document.documentElement;
            (elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen || (() => { })).call(elem);
        } else {
            (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || (() => { })).call(document);
        }
        isFullscreen = !isFullscreen;
    }

    // ========================
    // EVENT HANDLERS
    // ========================

    $(document).on('keydown', function (m_event) {
        if (m_event.ctrlKey || m_event.altKey || isUserTyping()) return;

        const key = m_event.key;

        // Scroll up
        if (isKeyMatch(key, KEY_BINDINGS.scrollUp) && !scrollingUp) {
            m_event.preventDefault();
            startScrolling('up');
            return;
        }

        // Scroll down
        if (isKeyMatch(key, KEY_BINDINGS.scrollDown) && !scrollingDown) {
            m_event.preventDefault();
            startScrolling('down');
            return;
        }

        // Previous chapter
        if (isKeyMatch(key, KEY_BINDINGS.prevChapter)) {
            safeClick(btnPrev, 'Previous Chapter');
            return;
        }

        // Next chapter
        if (isKeyMatch(key, KEY_BINDINGS.nextChapter)) {
            safeClick(btnNext, 'Next Chapter');
            return;
        }

        // Toggle fullscreen
        if (isKeyMatch(key, KEY_BINDINGS.fullscreen)) {
            m_event.preventDefault();
            toggleFullscreen();
            return;
        }

        // All chapters / go back to series page
        if (isKeyMatch(key, KEY_BINDINGS.allChapters)) {
            safeClick(btnAllChapters, 'All Chapters');
            return;
        }
    });

    $(document).on('keyup', function (m_event) {
        if (m_event.ctrlKey || m_event.altKey || isUserTyping()) return;

        const key = m_event.key;

        if (isKeyMatch(key, KEY_BINDINGS.scrollUp)) {
            stopScrolling('up');
        }
        if (isKeyMatch(key, KEY_BINDINGS.scrollDown)) {
            stopScrolling('down');
        }
    });

})();
