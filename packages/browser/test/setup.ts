// happy-dom reports navigator.webdriver = true, which the tracker treats as an automated
// browser and stays silent; the tests act as a real visitor unless they say otherwise.
Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
