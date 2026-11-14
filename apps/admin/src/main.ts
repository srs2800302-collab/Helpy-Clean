import { LanguageSettings } from './application/language-settings.ts';
import { browserLanguagePreference } from './infrastructure/browser-language-preference.ts';
import { mountAdmin } from './presentation/mount-admin.ts';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
mountAdmin(root, new LanguageSettings(browserLanguagePreference(window)));
