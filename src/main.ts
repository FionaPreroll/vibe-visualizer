import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { watchUncaughtErrors } from './ui/problems';

// From the first moment: errors nobody handles show in the app (NF-10).
watchUncaughtErrors();
mount(App, { target: document.getElementById('app')! });
