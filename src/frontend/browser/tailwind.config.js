/** @type {import('tailwindcss').Config} */
export default {
	content: [
		"./index.html",
		"./*.{js,ts,jsx,tsx}",
		"./components/**/*.{js,ts,jsx,tsx}",
		"./contexts/**/*.{js,ts,jsx,tsx}",
		"./layouts/**/*.{js,ts,jsx,tsx}",
		"./stores/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			colors: {
				dark: {
					50: "var(--dark-50)",
					100: "var(--dark-100)",
					200: "var(--dark-200)",
					300: "var(--dark-300)",
					400: "var(--dark-400)",
					500: "var(--dark-500)",
					600: "var(--dark-600)",
					700: "var(--dark-700)",
					800: "var(--dark-800)",
					900: "var(--dark-900)",
					950: "var(--dark-950)",
				},
				brand: "rgb(var(--brand) / <alpha-value>)",
				ember: "rgb(var(--ember) / <alpha-value>)",
				spark: "rgb(var(--spark) / <alpha-value>)",
				parchment: "rgb(var(--parchment) / <alpha-value>)",
				info: "rgb(var(--info) / <alpha-value>)",
				success: "rgb(var(--success) / <alpha-value>)",
				warning: "rgb(var(--warning) / <alpha-value>)",
				danger: "rgb(var(--danger) / <alpha-value>)",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
