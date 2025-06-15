import dotenv from 'dotenv'; // For loading environment variables
import express from 'express';
import cors from 'cors';
import twilio from 'twilio'; // Twilio Node.js SDK
import fetch from 'node-fetch'; // For making HTTP requests to external APIs (e.g., Google Maps)

// Load environment variables at the very beginning of the application
dotenv.config();

const app = express();
// Use port from .env or default to 5000 (consistent with your previous logs)
const port = process.env.PORT || 5000;

// --- Twilio Credentials from Environment Variables ---
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER; // Your Twilio phone number for sending SMS

// --- Google Maps Platform API Key ---
const GOOGLE_ROUTES_API_KEY = process.env.GOOGLE_ROUTES_API_KEY;

// --- Initialize Twilio Client ---
// It's good practice to add checks for missing credentials before initialization
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID || !TWILIO_PHONE_NUMBER) {
    console.error('CRITICAL ERROR: Missing one or more Twilio environment variables. Please check your .env file.');
    process.exit(1); // Exit if critical credentials are missing
}
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// --- Check Google Maps API Key ---
if (!GOOGLE_ROUTES_API_KEY) {
    console.error('ERROR: GOOGLE_ROUTES_API_KEY is not set in the .env file!');
    process.exit(1); // Exit if critical API key is missing
}

// --- Middleware Setup ---
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Crucial: include OPTIONS
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'], // Add any custom headers your frontend sends
  credentials: true, // If your frontend sends cookies or auth headers
}));
app.use(express.json()); // Enable JSON body parsing for incoming requests

// --- Helper function for E.164 phone number formatting ---
// Twilio requires phone numbers in E.164 format (e.g., +12345678900).
// This function attempts to format it if a country code is missing.
const formatPhoneNumberForTwilio = (number) => {
    if (!number) return null;
    // Remove any non-digit characters except for a leading '+'
    let cleanedNumber = number.replace(/[^\d+]/g, '');

    // If it doesn't start with '+', assume it's an Indian number and prepend '+91'
    if (!cleanedNumber.startsWith('+')) {
        return `+91${cleanedNumber}`;
    }
    return cleanedNumber;
};


// --- API Endpoint: Send OTP (Twilio Verify) ---
app.post('/api/send-otp', async (req, res) => {
    let { phoneNumber } = req.body;

    phoneNumber = formatPhoneNumberForTwilio(phoneNumber);

    if (!phoneNumber) {
        console.warn('Attempted to send OTP with empty or invalid phone number.');
        return res.status(400).json({ message: 'Phone number is required and must be valid.' });
    }

    try {
        console.log(`Attempting to send OTP to: ${phoneNumber} using Service SID: ${TWILIO_VERIFY_SERVICE_SID}`);
        const verification = await twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
            .verifications
            .create({ to: phoneNumber, channel: 'sms' });

        console.log('Twilio verification initiated. SID:', verification.sid);
        res.status(200).json({ message: 'OTP sent successfully!', sid: verification.sid });
    } catch (error) {
        let errorMessageForClient = 'Failed to send OTP. Please try again.';
        console.error('Detailed Twilio Error during OTP send:', error);

        if (error.status && error.message) {
            errorMessageForClient = `Twilio API Error (${error.status}): ${error.message}`;
        } else if (error instanceof Error) {
            errorMessageForClient = `Server Error: ${error.message}`;
        }
        res.status(500).json({ message: errorMessageForClient });
    }
});

// --- API Endpoint: Verify OTP (Twilio Verify) ---
app.post('/api/verify-otp', async (req, res) => {
    let { phoneNumber, otpCode } = req.body;

    phoneNumber = formatPhoneNumberForTwilio(phoneNumber);

    if (!phoneNumber || !otpCode) {
        return res.status(400).json({ message: 'Phone number and OTP code are required.' });
    }

    try {
        console.log(`Attempting to verify OTP for: ${phoneNumber} with code: ${otpCode}`);
        const verificationCheck = await twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
            .verificationChecks
            .create({ to: phoneNumber, code: otpCode });

        if (verificationCheck.status === 'approved') {
            console.log('OTP verification successful for:', phoneNumber);
            res.status(200).json({ message: 'OTP verified successfully!', status: 'approved' });
        } else {
            console.warn('OTP verification failed for:', phoneNumber, 'Status:', verificationCheck.status, 'Error Code:', verificationCheck.sna);
            res.status(400).json({ message: 'Invalid OTP. Please try again.', status: verificationCheck.status });
        }
    } catch (error) {
        let errorMessageForClient = 'Verification failed. Please try again.';
        console.error('Detailed Twilio Error during OTP verification:', error);

        if (error.status && error.message) {
            errorMessageForClient = `Twilio API Error (${error.status}): ${error.message}`;
        } else if (error instanceof Error) {
            errorMessageForClient = `Server Error: ${error.message}`;
        }
        res.status(500).json({ message: errorMessageForClient });
    }
});

// --- API Endpoint: Send Booking Confirmation SMS (Twilio Messaging) ---
app.post('/api/send-booking-sms', async (req, res) => {
    const { phoneNumber, bookingDetails } = req.body;

    if (!phoneNumber || !bookingDetails) {
        return res.status(400).json({ message: 'Phone number and booking details are required.' });
    }

    try {
        // Prepare the message content - customize as needed
        const messageBody = `
            Fasttrack Drop Taxi Booking Confirmed!
            ID: ${bookingDetails.bookingId || 'N/A'}
            From: ${bookingDetails.pickup || 'N/A'}
            To: ${bookingDetails.dropoff || 'N/A'}
            Date: ${bookingDetails.pickupDate || 'N/A'} ${bookingDetails.pickupTime || 'N/A'}
            Fare: ₹${bookingDetails.fareDetails?.total?.toFixed(2) || 'N/A'}
            Driver: ${bookingDetails.driverName || 'Assigned Soon'} (${bookingDetails.driverVehicle || 'N/A'})
            Download App for updates!
        `.replace(/^\s*\n|\n\s*$/g, '').replace(/\s+/g, ' ').trim(); // Clean up extra spaces/lines

        console.log(`Sending booking confirmation SMS to ${phoneNumber} with message: ${messageBody}`);

        const formattedPhoneNumber = formatPhoneNumberForTwilio(phoneNumber);

        if (!formattedPhoneNumber) {
            return res.status(400).json({ message: 'Invalid phone number format for SMS.' });
        }

        if (!TWILIO_PHONE_NUMBER) {
            console.error('TWILIO_PHONE_NUMBER is not set in environment variables.');
            return res.status(500).json({ message: 'Server configuration error: Twilio phone number for sending SMS is missing.' });
        }

        await twilioClient.messages.create({
            body: messageBody,
            to: formattedPhoneNumber,
            from: TWILIO_PHONE_NUMBER, // Your Twilio phone number (must be configured in .env)
        });

        console.log('Booking confirmation SMS sent successfully!');
        res.status(200).json({ message: 'Booking confirmation SMS sent.' });
    } catch (error) {
        console.error('Error sending booking confirmation SMS via Twilio:', error);
        let errorMessage = 'Failed to send booking confirmation SMS.';
        if (error.status && error.message) {
            errorMessage = `Twilio API Error (${error.status}): ${error.message}`;
        }
        res.status(500).json({ message: errorMessage });
    }
});


// --- API Endpoint for Toll Calculation (Google Maps Routes API) ---
app.post('/api/get-tolls', async (req, res) => {
    const { pickup, dropoff, distance, vehicleType } = req.body;

    console.log('Received toll request:', { pickup, dropoff, distance, vehicleType });

    if (!pickup || !dropoff) {
        return res.status(400).json({ message: 'Pickup and dropoff locations are required.' });
    }

    const routesApiUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    try {
        const googleRequestBody = {
            origin: {
                address: pickup,
            },
            destination: {
                address: dropoff,
            },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
            computeAlternativeRoutes: false,
            routeModifiers: {
                avoidTolls: false,
                avoidHighways: false,
                // --- Re-added the correct FASTag toll pass ---
                tollPasses: ['IN_FASTAG'], // Use the correct Google API enumeration for Indian FASTag
                // --- End re-added line ---
                // You can add vehicleInfo for more precise calculation if needed
                // vehicleInfo: { emissionType: 'GASOLINE' }, // Example
            },
            extraComputations: ['TOLLS'], // Crucial for getting toll information
        };

        const googleResponse = await fetch(routesApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_ROUTES_API_KEY,
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.travelAdvisory.tollInfo',
            },
            body: JSON.stringify(googleRequestBody),
        });

        if (!googleResponse.ok) {
            let errorData = {};
            try {
                errorData = await googleResponse.json();
            } catch (e) {
                errorData = { message: 'Could not parse error response from Google API.' };
            }
            console.error('Google Routes API error response:', googleResponse.status, errorData);
            return res.status(googleResponse.status).json({
                message: 'Error fetching route from Google Maps API',
                details: errorData.error ? errorData.error.message : (errorData.message || 'Unknown error from Google API'),
            });
        }

        const data = await googleResponse.json();
        // Uncomment the line below for full Google API response debugging:
        // console.log('Google API raw response data:', JSON.stringify(data, null, 2));

        let calculatedToll = 0;

        if (data.routes && data.routes.length > 0) {
            const firstRoute = data.routes[0];
            if (firstRoute.travelAdvisory && firstRoute.travelAdvisory.tollInfo && firstRoute.travelAdvisory.tollInfo.estimatedPrice) {
                firstRoute.travelAdvisory.tollInfo.estimatedPrice.forEach((price) => {
                    if (price.currencyCode === 'INR') {
                        // Explicitly convert units and nanos to numbers, defaulting to 0 if invalid
                        const units = Number(price.units) || 0;
                        const nanos = Number(price.nanos) || 0;

                        console.log(`Processing price: raw units=${price.units}, raw nanos=${price.nanos}, converted units=${units}, converted nanos=${nanos}`);

                        if (!isNaN(units) && !isNaN(nanos)) {
                            calculatedToll += units + nanos / 1_000_000_000;
                            console.log(`Added: ${units} + ${nanos/1_000_000_000}. Current calculatedToll: ${calculatedToll}`);
                        } else {
                            console.warn(`Skipping price entry for INR due to non-numeric parts after explicit conversion: units=${units} (from ${price.units}), nanos=${nanos} (from ${price.nanos})`);
                        }
                    }
                });
            } else {
                console.warn('Google Routes API response: No estimatedPrice or tollInfo found for the route.');
            }
        } else {
            console.warn('Google Routes API response: No routes found or data is empty.');
        }

        console.log('DEBUG: calculatedToll before toFixed:', calculatedToll, 'Type:', typeof calculatedToll);

        // Final type safeguard before sending the response
        if (typeof calculatedToll !== 'number' || isNaN(calculatedToll)) {
            console.error('CRITICAL: calculatedToll is not a valid number right before toFixed! Resetting to 0.');
            calculatedToll = 0;
        }

        res.json({ tollAmount: parseFloat(calculatedToll.toFixed(2)) });

    } catch (error) {
        console.error('Backend server error during toll calculation:', error);
        res.status(500).json({ message: 'Internal server error during toll calculation.', details: error.message || 'Unknown error' });
    }
});

// --- Start the Server ---
app.listen(port, () => {
    console.log(`Unified backend server running on http://localhost:${port}`);
    console.log(`Twilio endpoints: /api/send-otp, /api/verify-otp, /api/send-booking-sms`);
    console.log(`Google Maps endpoint: /api/get-tolls`);
});
