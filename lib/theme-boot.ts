/**
 * 🌗 Dark-Mode-Konstanten OHNE 'use client' — das Team-Layout (Server-
 * Komponente) braucht das Inline-Script als echten String; aus einem
 * 'use client'-Modul käme nur eine Client-Referenz an (§284).
 */
export const THEME_KEY = 'trimosa-theme'
export const DARK_BG = '#0f1114'
export const LIGHT_BG = '#f3f4f6'
/** Setzt die Klasse tm-dark vor dem ersten Frame (gespeicherter Modus oder System). */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem('${THEME_KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('tm-dark');document.documentElement.style.backgroundColor='${DARK_BG}';}}catch(e){}})()`
