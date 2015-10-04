/*
*	To run, use the following commands
*	`npm install`
*	`node stats.js --league NAME_OF_LEAGUE --week WEEK_NUMBER [--mongoUrl localhost] [--mongoPort 27017]`
 */

var MongoClient    = require('mongodb').MongoClient;
var argv           = require('minimist')(process.argv.slice(2));
var leagues        = require('./leagues.json');

//
// Parse Arguments

// Get the league config obj
var league = argv.league;
var leagueObj = leagues[league];
if(!league || !leagueObj){
	console.log('Please specify a league using the `--league` flag.');
	console.log('The following leagues are available:');
	for(var l in leagues){
		console.log(l);
	}
	throw('Please specify a league using the `--league` flag.');
}

// Get Week Number. Use all weeks if not given
var week = parseInt(argv.week, 10);
if(!week){
	week = 'all';
}

// Get URL of MongoDB connection
var mongoUrl = argv.mongoUrl;
if(!mongoUrl){
	mongoUrl = 'localhost';
}

// Get Port of MongoDB connection
var mongoPort = argv.mongoPort;
if(!mongoPort){
	mongoPort = '27017';
}

// Set Collection Name
var testRun = argv.testRun;
var collectionName = 'games';
if(testRun){
	collectionName = 'test';
}


// Before we get going, connect to Mongo
MongoClient.connect('mongodb://' + mongoUrl + ':' + mongoPort +'/'+ leagueObj.dbName, function(err, db) {
	if(err) throw err;

	// Output header
	console.log('');
	console.log('');
	console.log('=========================');
	if(week === 'all'){
		console.log(' Year-to-date statistics');
	} else {
		console.log('    Week ' + week + ' statistics');
	}
	console.log('=========================');
	console.log('');
	console.log('');

	// Start doing some calculations
	calculateTeamsVsProjections(db, function(db){
		calculateGameResults(db, function(db){
			calculateProjectionPercentage(db);
		});
	});
});

var calculateTeamsVsProjections = function(db, callback){
	var Games = db.collection(collectionName);
	var teamsVsProjectionsAggregate = [
		{$match: {'_id.w' :  week}},
		{$unwind: '$scores'},
		{$project: {
			_id  : 0,
			week : '$_id.w',
			team : '$scores.team',
			projected : '$scores.proj',
			actual : '$scores.actual',
			adjusted : '$scores.adjustedTotal',
			diff : { $subtract : ['$scores.adjustedTotal', '$scores.proj'] },
		}},
		{$sort : { diff : -1 }}
	];

	if(week === 'all'){
		teamsVsProjectionsAggregate.shift();
	}


	var teamsVsProjections = Games.aggregate(teamsVsProjectionsAggregate);

	console.log('Teams vs. projections');
	console.log('=========================');
	console.log('');
	teamsVsProjections.each(function(err, doc){
		if(!err && doc) {
			var statStr = '';
			console.log(doc.team + ', Week ' + doc.week);
			console.log('------------');
			statStr += 'Projected: ' + doc.projected + '; Actual: ' + doc.actual + '; ';
			if(doc.adjusted !== doc.actual) {
				statStr += 'Adjusted: ' + doc.adjusted + '; ';
			}
			statStr += 'Diff: ' + (doc.diff > 0 ? '+' : '') + doc.diff.toFixed(2);
			console.log(statStr);
			console.log('');
		}
	});
	var avgScoreAggregate = [
	    {$match: {'_id.w' :  week}},
	    {$unwind: '$scores'},
	    {$project: {
	    	_id  : 0,
	    	diff : { $subtract : ['$scores.adjustedTotal', '$scores.proj'] }
	    }},
	    {$group: {
	    	_id : null,
	    	'avg' : {$avg : '$diff'}
	    }},
	    {$project : {
	    	_id : 0,
	    	averageDiff : '$avg'
	    }}
	];

	if(week === 'all'){
		avgScoreAggregate.shift();
	}

	var avgScore = Games.aggregate(avgScoreAggregate);


	avgScore.each(function(err, doc){
		if(!err && doc) {
			console.log('');
			console.log('Average score vs. projection');
			console.log('=========================');
			console.log('');
			console.log((doc.averageDiff > 0 ? '+' : '') + doc.averageDiff.toFixed(2));
		} else if(!doc) {
			if(callback){
				callback(db);
			} else {
				db.close();
			}
		}
	});
};

var calculateGameResults = function(db, callback){
	var Games = db.collection(collectionName);

	console.log('');
	console.log('');
	console.log('How often was the outcome of the game correctly projected?');
	console.log('==========================================================');

	var correctGames = Games.aggregate(outcomeAggregate);

	correctGames.each(function(err, doc){
		if(!err && doc) {
			console.log('');
			console.log(doc.matchup);
			console.log('--------------------');
			console.log('Projected Winner : ' + doc.projectedWinner);
			console.log('Actual Winner : ' + doc.actualWinner);
			console.log('Actual Winner with Spread: ' + doc.actualWinnerWithSpread);
			console.log('Projection was ' + doc.wasProjectionCorrect);
		} else if(!doc) {
			if(callback){
				callback(db);
			} else {
				db.close();
			}
		}
	});
};

var calculateProjectionPercentage = function(db, callback){
	var Games = db.collection(collectionName);
	console.log('');

	var percentage = Games.aggregate(outcomeAggregate.concat([
		{$sort: {
			'wasProjectionCorrect' : 1
		}},
		{$group : {
			_id : '$wasProjectionCorrect',
			count : {$sum : 1}
		}},
		{$group: {
			_id : null,
			correctIncorrect : {$addToSet : '$count'},
		}},
		{$unwind : '$correctIncorrect'},
		{$group : {
			_id : null,
			correct : {$first : '$correctIncorrect'},
			incorrect : {$last : '$correctIncorrect'},
			total : {$sum : '$correctIncorrect'}
		}},
		{$project : {
			_id : 0,
			percentageCorrect :
				{$multiply : [100, {$divide : ['$correct', '$total']}]},
		}}
	]));

	percentage.each(function(err, doc){
		if(!err && doc) {
			console.log('Projections were correct ' + doc.percentageCorrect.toFixed(2) + '% of the time.');
			console.log('');
		} else if(!doc) {
			if(callback){
				callback(db);
			} else {
				db.close();
			}
		}
	});
};

var outcomeAggregate = [
	{$match: {'_id.w' :  week}},
	{$project: {
		week : '$_id.w',
		scores : 1,

	}},
	{$unwind: '$scores'},
	{$group : {
		_id : {g : '$_id.g', w: '$_id.w'},

		awayTeam : {$first: '$scores.team'},
		awayProj : {$first : '$scores.proj'},
		awayActual : {$first : '$scores.actual'},
		awayLine : {$first : '$scores.line'},

		homeTeam : {$last: '$scores.team'},
		homeProj : {$last : '$scores.proj'},
		homeActual : {$last : '$scores.actual'},
		homeLine : {$last : '$scores.line'}
	}},
	{$project: {
		matchup : {$concat : [
			'Week ',
			{ "$substr": [ "$_id.w" , 0 , -1] },
			' : ' ,'$awayTeam', ' @ ', '$homeTeam'
		]},
		projectedDiff : {$subtract : ['$awayProj', '$homeProj']},
		actualDiff : {$subtract : ['$awayActual', '$homeActual']},
		awayActualWithSpread : {$add : ['$awayActual', '$awayLine' ]},
		homeActual : 1,
		awayTeam : 1,
		homeTeam : 1
	}},
	{$project : {
		matchup : 1,
		projectedDiff : 1,
		actualDiff : 1,
		actualDiffWithSpread : {$subtract : ['$awayActualWithSpread', '$homeActual']},
		awayTeam : 1,
		homeTeam : 1
	}},
	{$project : {
		matchup : 1,
		projectedWinner: {$cond : [{$gt : ['$projectedDiff', 0]},'$awayTeam', '$homeTeam']},
		actualWinner: {$cond : [{$gt : ['$actualDiff', 0]}, '$awayTeam', '$homeTeam' ]},
		actualWinnerWithSpread : {$cond : [{$gt : ['$actualDiffWithSpread', 0]}, '$awayTeam', '$homeTeam' ]},

	}},
	{$project : {
		matchup: 1,
		projectedWinner : 1,
		actualWinner : 1,
		actualWinnerWithSpread : 1,
		wasProjectionCorrect : {$cond : [{$eq : ['$projectedWinner', '$actualWinner']}, 'Correct', 'Incorrect']}
	}},
	{$sort: {
		'_id.g' : 1
	}},
	{$project : {
		_id : 0,
		matchup: 1,
		projectedWinner : 1,
		actualWinner : 1,
		actualWinnerWithSpread : 1,
		wasProjectionCorrect : 1
	}}
];

if(week === 'all'){
	outcomeAggregate.shift();
}
