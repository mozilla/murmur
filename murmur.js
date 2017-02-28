var fs = require('fs');

var uploaddir = __dirname + '/uploads';  // Upload directory
var directoryToSentence = {};            // dirname to sentence
var directoryToFileNumber = {};          // dirname to next file number to use
var directories = [];                    // all the directories

// Here's the program:
readConfigFile();
startServer();

/*
 * Synchronous startup stuff before we start handling requests.
 * This reads the sentences.txt configuration file, creates directories
 * as needed, and figures out the next file number in each directory.
 */
function readConfigFile() {
  var configFile = __dirname + '/sentences.txt';

  try {
    fs.readFileSync(configFile, 'utf8')
      .trim()
      .split('\n')
      .forEach(function(line) {
        var trimmed = line.trim();
        if (trimmed === '' || trimmed[0] === '#') {
          return;  // ignore blanks and comments
        }
        var match = trimmed.match(/^(\w+)\s+(.*)$/);
        if (!match) {
          console.warn('Ignoring mis-formatted line in sentences.txt:',
                       line);
          return;
        }
        var directory = match[1];
        var sentence = match[2];

        if (directory in directoryToSentence) {
          console.warn('Ignoring line in sentences.txt because directory',
                       'is already in use:', line);
          return;
        }

        directoryToSentence[directory] = sentence;
        directories.push(directory);
      });
  }
  catch(e) {
    console.error('Error reading configuration file:', configFile,
                  '\n', e);
    process.exit(1);
  }

  if (directories.length === 0) {
    console.error('No sentences defined in sentences.txt. Exiting.');
    process.exit(1);
  }

  directories.forEach(function(directory) {
    try {
      var dirname = uploaddir + '/' + directory;
      if (fs.existsSync(dirname)) {
        // Directory exists. Go find out what the next filenumber is
        var filenumbers =
            fs.readdirSync(dirname)                         // all files
            .filter(function(f) { return f.match(/^\d+/);}) // starting with #
            .map(function(f) { return parseInt(f); })       // convert to number
            .sort(function(a,b) { return b - a; });         // largest first
        directoryToFileNumber[directory] = (filenumbers[0] + 1) || 0;
      }
      else {
        // Directory does not exist. Create it and start with file 0
        fs.mkdirSync(dirname);
        directoryToFileNumber[directory] = 0;
      }
    }
    catch(e) {
      // This can happen, for example, if dirname is a file instead of
      // a directory or if there is a directory that is not readable
      console.warn('Error verifying directory', dirname,
                   'Ignoring that directory', e);
    }
  });
}

function startServer() {
  var LEX = require('letsencrypt-express')/*.testing()*/;
  var http = require('http');
  var https = require('spdy');
  var express = require('express');
  var bodyParser = require('body-parser');
  var sqlite3 = require('sqlite3').verbose();

  // Read the server configuration file. It must define
  // letsEncryptHostname and letsEncryptEmailAddress for the
  // certificate registration process
  try {
    var config = JSON.parse(fs.readFileSync('server.conf'));
  }
  catch(e) {
    console.error("Failed to read server.conf:", e);
    console.error("Exiting");
    process.exit(1);
  }

  var db = new sqlite3.Database(config.db);

  var lex = LEX.create({
    configDir: __dirname + '/letsencrypt.conf',
    approveRegistration: function (hostname, approve) {
      console.log("approveRegistration:", hostname);
      if (hostname === config.letsEncryptHostname) {
        approve(null, {
          domains: [config.letsEncryptHostname],
          email: config.letsEncryptEmailAddress,
          agreeTos: true
        });
      }
    }
  });

  var app = express();

  // Serve static files in the public/ directory
  app.use(express.static('public'));

  // When the client issues a GET request for the list of sentences
  // create that dynamically from the data we parsed from the config file
  app.get('/sentences.json', function(request, response) {
    response.send(directoryToSentence);
  });

  // When we get POSTs, handle the body like this
  app.use(bodyParser.raw({
    type: 'audio/*',
    limit: 1*1024*1024  // max file size 1 mb
  }));

  // This is how we handle WAV file uploads
  app.post('/upload/:dir', function(request, response) {
    var uid = request.headers['uid'];
    var dir = request.params.dir;
    var filenumber = directoryToFileNumber[dir];
    if (filenumber !== undefined) { // Only if it is a known directory
      directoryToFileNumber[dir] = filenumber + 1;
      var filename = String(filenumber);
      while(filename.length < 4) filename = '0' + filename;

      var extension = '.ogg';  // Firefox gives us opus in ogg
      if (request.headers['content-type'].startsWith('audio/webm')) {
        extension = '.webm';   // Chrome gives us opus in webm
      } else if (request.headers['content-type'].startsWith('audio/mp4a')) {
        extension = '.mp4a' // iOS gives us mp4a
      }

      var path = uploaddir + '/' + dir + '/'  + uid  + extension;
      fs.writeFile(path, request.body, {}, function(err) {
        response.send('Thanks for your contribution!');
        if (err) {
          console.warn(err);
        }
        else {
          console.log('wrote file:', path);
        }
      });
    }
    else {
      response.status(404).send('Bad directory');
    }
  });

  app.get('/data/', function(request,response) {
      db.serialize(function() {
          var id = Math.random() * Date.now() * (request.headers.gender + request.headers.age + request.headers.langs1 + request.headers.langs2);
          var stmt = db.prepare("INSERT INTO usr VALUES (?,?,?,?,?)");
          stmt.run(id, request.headers.gender, request.headers.age, request.headers.langs1, request.headers.langs2);
          stmt.finalize();
          response.send({ uid: id });
      });
  });

  // In test mode, just run the app over http to localhost:8000
  if (process.argv[2] === 'test') {
    app.listen(8000, function() {
      console.log("listening on port 8000");
    });
    return;
  }

  // Redirect all HTTP requests to HTTPS
  http.createServer(LEX.createAcmeResponder(lex, function(req, res) {
    res.setHeader('Location', 'https://' + req.headers.host + req.url);
    res.statusCode = 302;
    res.end('<!-- Please use https:// links instead -->');
  })).listen(config.httpPort || 8080);


  // Handle HTTPs requests using LEX and the Express app defined above
  https.createServer(lex.httpsOptions,
                     LEX.createAcmeResponder(lex, app))
    .listen(config.httpsPort || 443);
}
