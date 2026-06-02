// Yeh hoga abhi
app.listen(8080, ...)

// Yeh karo
const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`Running on port ${PORT}`))
