const theme = localStorage.getItem('node-magic-theme');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
