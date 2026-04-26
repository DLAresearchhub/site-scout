# Site Scout - Rapid Architectural Feasibility Visualiser

A production-ready Node.js + Express web application for exploring vacant/derelict sites and visualising proposed buildings using Google Earth and Google Gemini image generation.

## Features

- **Site Discovery**: Search for vacant and derelict sites in any city
- **Google Earth Integration**: View sites from multiple angles (stubbed for integration)
- **Building Configuration**: Specify building type, height, and architectural style
- **Gemini Image Generation**: Generate photorealistic drone-style CGI visualisations (stubbed for integration)
- **Admin Dashboard**: Track usage, view statistics, and monitor generation activity
- **SQLite Logging**: Comprehensive usage and generation logs
- **Railway Deployment Ready**: Procfile and correct environment configuration

## Tech Stack

- **Backend**: Node.js, Express, body-parser
- **Database**: SQLite (better-sqlite3)
- **Sessions**: express-session with connect-sqlite3
- **Frontend**: Vanilla JavaScript (no heavy frameworks)
- **Image Generation**: Google Gemini API (stubbed)
- **Styling**: Custom CSS with dark theme

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

1. **Clone/extract the repository**
   ```bash
   cd site-scout
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` with your settings**
   ```env
   PORT=3000
   ADMIN_PASSWORD=your-secure-password
   SESSION_SECRET=your-random-secret-key
   GEMINI_API_KEY=your-gemini-api-key
   NODE_ENV=production
   ```

5. **Start the server**
   ```bash
   npm start
   ```

   The app will be available at `http://localhost:3000`

## Project Structure

```
site-scout/
├── package.json              # Dependencies and scripts
├── Procfile                  # Railway deployment config
├── .env.example              # Environment template
├── .gitignore                # Git ignore rules
├── server.js                 # Express app entry point
├── routes/
│   ├── index.js             # Static page routes
│   ├── api.js               # API endpoints (search, generate, status)
│   └── admin.js             # Admin dashboard routes
├── services/
│   ├── site-finder.js       # Site search (stubbed)
│   ├── earth-capture.js     # Google Earth automation (stubbed)
│   ├── prompt-builder.js    # Gemini prompt construction
│   ├── image-generator.js   # Gemini API wrapper (stubbed)
│   └── usage-logger.js      # SQLite logging service
├── public/
│   ├── index.html           # Main app UI
│   ├── admin.html           # Admin dashboard UI
│   ├── css/
│   │   ├── app.css          # Main app styles
│   │   └── admin.css        # Admin styles
│   └── js/
│       ├── app.js           # Main app logic
│       └── admin.js         # Admin dashboard logic
├── db/
│   └── schema.sql           # SQLite schema reference
└── README.md                # This file
```

## API Endpoints

### Main App

- `GET /` - Main application
- `GET /health` - Health check

### Site Search & Generation

- `POST /api/search-sites` - Search for sites in a city
- `POST /api/capture-site` - Capture site angles from Earth
- `POST /api/generate` - Queue a building visualization job
- `GET /api/status/:jobId` - Get generation job status

### Admin

- `GET /admin` - Admin dashboard
- `POST /admin/login` - Authenticate with password
- `POST /admin/logout` - Logout
- `GET /admin/check-auth` - Check authentication status
- `GET /admin/stats` - Get usage statistics (requires auth)

## Usage Workflow

1. **Search** → User enters city, app finds 3 candidate sites
2. **Scout** → User views site in Google Earth, captures angles
3. **Configure** → User selects building type, height, and style
4. **Generate** → App queues visualization job with Gemini
5. **View Results** → Hero aerial image + 5 supporting views
6. **Download** → User can download individual images

## Stubbed Features

The following are stubbed and ready for implementation:

### `services/site-finder.js`
- **Currently**: Returns fake realistic-looking sites with hardcoded data for London, Manchester, Bristol
- **TODO**: Integrate with Google Maps/Places API or web search for real site discovery

### `services/earth-capture.js`
- **Currently**: Returns placeholder SVG screenshots at 6 angles
- **TODO**: Implement Playwright automation for Google Earth Web to capture real 3D views

### `services/image-generator.js`
- **Currently**: Returns SVG placeholder images with type labels
- **TODO**: Implement actual Google Gemini image generation API with proper prompt crafting

### `services/prompt-builder.js`
- **Currently**: Functional! Builds detailed, context-aware prompts
- **Status**: Ready to use with Gemini API

## Environment Configuration

### Required Variables

- `PORT` - Server port (default: 3000)
- `ADMIN_PASSWORD` - Admin dashboard password
- `SESSION_SECRET` - Secret for session encryption
- `NODE_ENV` - `production` or `development`

### Optional Variables

- `GEMINI_API_KEY` - Google Gemini API key (for image generation)

## Admin Dashboard

Access at `/admin`

### Features

- Password-protected login
- Live statistics:
  - Total/weekly/today sessions
  - Total/weekly/today images generated
  - Daily usage bar chart (last 7 days)
  - Top building types
  - Top cities
  - Recent sessions table
- Auto-refreshes every 30 seconds

### Default Login

Default password is set in `.env` as `ADMIN_PASSWORD`. Change this in production!

## Deployment to Railway

1. Push code to GitHub
2. Connect repo to Railway
3. Set environment variables in Railway dashboard
4. Railway will automatically detect `Procfile` and start the app
5. App will be available at generated Railway URL

## Design Language

- **Dark Theme**: Professional architecture tool aesthetic
- **Colors**: 
  - Background: `#0a0a0f`
  - Surface: `#13131a`
  - Accent: `#4f8ef7` (Blue)
  - Success: `#4caf87` (Green)
  - Text: `#e8e8f0`
- **Font**: Inter (Google Fonts) with system-ui fallback
- **Radius**: 12px rounded corners
- **No Heavy Shadows**: Subtle borders instead

## Development Tips

### Running Locally

```bash
npm start
```

Server starts on port 3000. Open `http://localhost:3000` in browser.

### Admin Dashboard

```
URL: http://localhost:3000/admin
Password: changeme (from .env)
```

### Database

SQLite database auto-creates on startup at `database.db`. Delete to reset.

### Logs

Check server console for debug logs. Environment-sensitive error messages in responses.

## Next Steps

1. **Integrate Google Maps API** in `site-finder.js` for real site discovery
2. **Implement Playwright** in `earth-capture.js` for Google Earth Web automation
3. **Connect Gemini API** in `image-generator.js` for real image generation
4. **Add user authentication** if expanding beyond single-user/admin use
5. **Implement Redis** for job queue if scaling generations
6. **Add S3/Cloud Storage** for persistent image storage

## License

MIT

## Support

For implementation details, see inline TODO comments in stubbed services.
