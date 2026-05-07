require("dotenv").config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const helmet = require("helmet");

const app = express();

// ----------------- SECURITY -----------------
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// ✅ Custom CSP
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "" +
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm https://cdn.jsdelivr.net/npm/chart.js; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com http://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
      "font-src 'self' https://fonts.gstatic.com http://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com data:; " +
      "connect-src 'self' https://www.gstatic.com https://dialogflow.cloud.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
      "frame-src 'self' https://www.gstatic.com https://dialogflow.cloud.google.com; " +
      "img-src 'self' data: https:; " +
      "object-src 'none';"
  );
  next();
});

// ----------------- SESSION SETUP -----------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// ----------------- GLOBAL USERNAME -----------------
app.use((req, res, next) => {
  res.locals.userName = req.session.userName || null;
  next();
});

// ----------------- EJS & STATIC FILES -----------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use("/assests", express.static(path.join(__dirname, "assests")));
app.use(bodyParser.urlencoded({ extended: true }));

// ----------------- DATABASE -----------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});
pool.on("error", (err) => console.error("Unexpected DB error:", err));

// ----------------- EMAIL SETUP -----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ----------------- ROUTES -----------------
app.get("/", (req, res) => res.render("index.ejs"));

app.get("/signup", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.send("All fields are required");

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (existingUser.rows.length > 0) return res.send("Email already exists.");

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (name, email, password) VALUES ($1,$2,$3)", [
      name,
      email,
      hashedPassword,
    ]);
    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error during signup");
  }
});

app.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("login.ejs");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user) return res.send("Invalid credentials");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Invalid credentials");

    req.session.userId = user.id;
    req.session.userName = user.name;
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("dashboard.ejs", { userName: req.session.userName });
});

app.get("/dashboardstats", (req, res) => {
  res.render("dashboardstats.ejs", { userName: req.session.userName || "Guest" });
});

app.get("/donate", async (req, res) => {
  try {
    const result = await pool.query("SELECT name, blood_group FROM blood_donors ORDER BY name ASC");
    res.render("donate.ejs", { donors: result.rows });
  } catch (err) {
    console.error("DONATE ERROR:", err);
    res.status(500).send("Error: " + err.message);
  }
});

app.get("/donate/blood/form", (req, res) => res.render("donateForm.ejs"));
app.post("/donate/blood/form", async (req, res) => {
  const { name, email, dob, bloodGroup, phone, address } = req.body;
  try {
    await pool.query(
      "INSERT INTO blood_donors (name, email, dob, blood_group, phone, address) VALUES ($1,$2,$3,$4,$5,$6)",
      [name, email, dob, bloodGroup, phone, address]
    );
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "LifeNest Blood Donation Confirmation",
      text: `Dear ${name},\nThank you for registering to donate blood with LifeNest.\n\nTeam LifeNest ❤️`,
    });
    res.render("donateSuccess.ejs", { name, email });
  } catch (err) {
    console.error("DONATE FORM ERROR:", err);
    res.status(500).send("Error saving donor info: " + err.message);
  }
});

app.post("/donate/receive", async (req, res) => {
  const { name, email, phone, address, bloodGroup } = req.body;
  try {
    const availableResult = await pool.query(
      "SELECT COUNT(*) FROM blood_donors WHERE blood_group = $1",
      [bloodGroup]
    );
    const availableCount = parseInt(availableResult.rows[0].count, 10);
    const available = availableCount > 0 ? "Available" : "Currently Not Available";

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "LifeNest Blood Request Received",
      text: `Dear ${name},\nYour blood request (${bloodGroup}) has been received.\nStatus: ${available}\n\nTeam LifeNest ❤️`,
    });
    res.render("receiveSuccess.ejs", { name, available });
  } catch (err) {
    console.error("Error saving blood receiver:", err);
    res.status(500).send("Error processing blood request: " + err.message);
  }
});

app.get("/donate/organ", (req, res) => res.render("donateOrgan.ejs"));
app.get("/donate/organ/form", (req, res) => res.render("donateOrganForm.ejs"));
app.get("/prerequisites", (req, res) => res.render("preRequisites.ejs"));
app.get("/organPrerequisites", (req, res) => res.render("organPrerequisites"));

app.post("/donate/organ/form", async (req, res) => {
  const { name, email, dob, organ, phone, address, nearbyHospital } = req.body;
  try {
    const birthYear = new Date(dob).getFullYear();
    const age = new Date().getFullYear() - birthYear;
    if (age < 20) return res.send("Must be 20+ to donate organ");

    await pool.query(
      `INSERT INTO organ_donors (name, email, dob, organ, phone, address, nearby_hospital)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [name, email, dob, organ, phone, address, nearbyHospital]
    );
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "LifeNest Organ Donation Confirmation",
      text: `Dear ${name},\nThank you for donating an organ (${organ}) with LifeNest.\n\nTeam LifeNest ❤️`,
    });
    res.render("donateOrganSuccess.ejs", { name, email });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving organ donor: " + err.message);
  }
});

app.get("/donate/organ/receive", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT name, organ, phone, nearby_hospital FROM organ_donors ORDER BY name ASC"
    );
    res.render("organReceive.ejs", { donors: result.rows });
  } catch (err) {
    console.error("Error loading organ donors:", err);
    res.status(500).send("Error loading organ donors: " + err.message);
  }
});

app.post("/donate/organ/receive", async (req, res) => {
  const { name, email, phone, address, organNeeded, nearbyHospital } = req.body;
  try {
    await pool.query(
      `INSERT INTO organ_receivers (name, email, phone, address, organ_needed, nearby_hospital)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name, email, phone, address, organNeeded, nearbyHospital]
    );
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "LifeNest Organ Receiver Confirmation",
      text: `Dear ${name},\nThank you for registering to receive an organ (${organNeeded}) with LifeNest.\nWe'll reach out when a suitable donor is available.\n\nTeam LifeNest ❤️`,
    });
    res.render("organReceiveSuccess.ejs", { name, email });
  } catch (err) {
    console.error("Error saving organ receiver:", err);
    res.status(500).send("Error saving organ receiver: " + err.message);
  }
});

app.get("/donate/organ/hospitals", async (req, res) => {
  const organ = req.query.organ;
  try {
    const result = await pool.query(
      "SELECT nearby_hospital AS hospital_name FROM organ_donors WHERE organ = $1",
      [organ]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching hospitals:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/donate/receive", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT name, blood_group, phone, address FROM blood_donors ORDER BY name ASC"
    );
    res.render("receiveBlood.ejs", { donors: result.rows });
  } catch (err) {
    console.error("Error loading donors:", err);
    res.status(500).send("Error loading blood donors: " + err.message);
  }
});

app.get("/queriesblood", (req, res) => res.render("queriesblood.ejs"));
app.post("/queriesblood", async (req, res) => {
  const { name, email, query } = req.body;
  try {
    await pool.query(
      "INSERT INTO queries (name, email, query) VALUES ($1, $2, $3)",
      [name, email, query]
    );
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "LifeNest Query Received",
      text: `Dear ${name},\n\nThank you for reaching out to LifeNest.\nWe've received your query and will get back to you soon.\n\nBlessings,\nTeam LifeNest ❤️`,
    });
    res.render("queriesSuccess.ejs", { name, email });
  } catch (err) {
    console.error("Error handling query:", err);
    res.status(500).send("Error submitting query: " + err.message);
  }
});

app.get("/api/types", async (req, res) => {
  try {
    const bloodQry = await pool.query(
      "SELECT COALESCE(blood_group, 'Unknown') AS type, COUNT(*)::int AS total FROM blood_donors GROUP BY blood_group ORDER BY total DESC"
    );
    const organQry = await pool.query(
      "SELECT COALESCE(organ, 'Unknown') AS type, COUNT(*)::int AS total FROM organ_donors GROUP BY organ ORDER BY total DESC"
    );
    res.json({ bloodTypes: bloodQry.rows, organTypes: organQry.rows });
  } catch (err) {
    console.error("Error /api/types:", err);
    res.json({
      bloodTypes: [
        { type: "A+", total: 40 },
        { type: "B+", total: 20 },
        { type: "O+", total: 15 },
        { type: "AB+", total: 10 },
        { type: "A-", total: 5 },
      ],
      organTypes: [
        { type: "Kidney", total: 30 },
        { type: "Heart", total: 20 },
        { type: "Brain", total: 10 },
      ],
    });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    let bloodStats;
    try {
      bloodStats = await pool.query(
        `SELECT (donated_at::date) AS donated_at, COUNT(*)::int AS count
         FROM blood_donors
         GROUP BY donated_at::date
         ORDER BY donated_at::date`
      );
    } catch (e1) {
      try {
        bloodStats = await pool.query(
          `SELECT (created_at::date) AS donated_at, COUNT(*)::int AS count
           FROM blood_donors
           GROUP BY created_at::date
           ORDER BY created_at::date`
        );
      } catch (e2) {
        bloodStats = null;
      }
    }

    let organStats;
    try {
      organStats = await pool.query(
        `SELECT (donated_at::date) AS donated_at, COUNT(*)::int AS count
         FROM organ_donors
         GROUP BY donated_at::date
         ORDER BY donated_at::date`
      );
    } catch (e1) {
      try {
        organStats = await pool.query(
          `SELECT (created_at::date) AS donated_at, COUNT(*)::int AS count
           FROM organ_donors
           GROUP BY created_at::date
           ORDER BY created_at::date`
        );
      } catch (e2) {
        organStats = null;
      }
    }

    if (bloodStats || organStats) {
      return res.json({
        bloodStats: bloodStats ? bloodStats.rows : [],
        organStats: organStats ? organStats.rows : [],
      });
    }

    res.json({
      bloodStats: [
        { donated_at: "2025-10-24", count: 40 },
        { donated_at: "2025-10-28", count: 2 },
        { donated_at: "2025-10-29", count: 5 },
        { donated_at: "2025-10-30", count: 0 },
      ],
      organStats: [
        { donated_at: "2025-10-24", count: 5 },
        { donated_at: "2025-10-28", count: 1 },
        { donated_at: "2025-10-29", count: 10 },
        { donated_at: "2025-10-30", count: 3 },
      ],
    });
  } catch (err) {
    console.error("Error /api/stats (outer):", err);
    res.json({
      bloodStats: [
        { donated_at: "2025-10-24", count: 40 },
        { donated_at: "2025-10-28", count: 2 },
        { donated_at: "2025-10-29", count: 5 },
        { donated_at: "2025-10-30", count: 0 },
      ],
      organStats: [
        { donated_at: "2025-10-24", count: 5 },
        { donated_at: "2025-10-28", count: 1 },
        { donated_at: "2025-10-29", count: 10 },
        { donated_at: "2025-10-30", count: 3 },
      ],
    });
  }
});

// ✅ FEEDBACK ROUTES
app.get("/feedback", (req, res) => res.render("feedback.ejs"));
app.post("/feedback", async (req, res) => {
  const { name, email, category, message, rating } = req.body;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Feedback from ${name}`,
      text: `Category: ${category}\nRating: ${rating}\nMessage: ${message}`,
    });
    const lowRating = Number(rating) <= 3;
    res.render("feedbackSuccess.ejs", { name, lowRating });
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).send("Error submitting feedback: " + err.message);
  }
});

app.get("/feedbackSuccess", (req, res) => res.render("feedbackSuccess.ejs"));
app.get("/about", (req, res) => res.render("about.ejs"));
app.get("/contact", (req, res) => res.render("contact.ejs"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));