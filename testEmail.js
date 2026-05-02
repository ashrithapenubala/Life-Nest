require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const mailOptions = {
  from: process.env.EMAIL_USER,
  to: process.env.EMAIL_USER,  // sends test email to yourself
  subject: "Test Email from LifeNest",
  text: "Hello! This is a test email to check Nodemailer setup."
};

transporter.sendMail(mailOptions, (err, info) => {
  if (err) {
    console.error("Error sending email:", err.message);
  } else {
    console.log("Email sent successfully:", info.response);
  }
});
