const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// Health Check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        message: "Server Running"
    });
});

// Index Test Route
app.get("/index/:symbol", (req, res) => {
    res.json({
        success: true,
        symbol: req.params.symbol
    });
});

// Quote Route
app.post("/angel/quote", async (req, res) => {
    try {
        res.json({
            success: true,
            data: req.body
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

// Option Chain Route
app.post("/angel/optionchain", async (req, res) => {
    try {
        res.json({
            success: true,
            data: req.body
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
