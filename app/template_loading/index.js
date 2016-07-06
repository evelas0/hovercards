var _       = require('underscore');
var async   = require('async');
var urls    = require('hovercardsshared/urls');
var Ractive = require('ractive');

var authentication = require('../authentication');
var config         = require('../config');
var service        = require('../service');
require('../common/mixins');

Ractive.DEBUG = process.env.NODE_ENV !== 'production';

Ractive.prototype.observeUntil = function(keypath, handler, options) {
	if (this.get(keypath)) {
		handler(this.get(keypath));
		return { cancel: _.noop };
	}
	return this.observeOnce(keypath, handler, options);
};

Ractive.prototype.service = function(keypath, identity, handler) {
	var ractive = this;
	var val     = ractive.get(keypath);
	if (val && val.loaded) {
		return (handler || _.noop)(null, val);
	}
	ractive.set(keypath + '.loading', true);
	ractive.set(keypath + '.loaded', false);
	service(identity || val, function try_service(err, data) {
		if (err) {
			ractive.set(keypath + '.err', err);
			ractive.set(keypath + '.loaded', true);
			ractive.set(keypath + '.loading', false);
			if (_.contains([401, 429], err.status)) {
				var do_it = function() {
					ractive.set(keypath + '.err.authenticate', function authenticate() {
						ractive.set(keypath + '.err.authenticate', _.noop);
						authentication((identity || val).api, function(err) {
							if (err) {
								ractive.set(keypath + '.err', err);
								return ractive.set(keypath + '.err.authenticate', authenticate);
							}
							ractive.set(keypath + '.loading', true);
							ractive.set(keypath + '.loaded', false);
							ractive.set(keypath + '.err', null);
							service(identity || val, try_service);
						});
					});
				};
				if (err.status === 429) {
					chrome.storage.sync.get((identity || val).api + '_user', function(obj) {
						if (obj[(identity || val).api + '_user']) {
							return;
						}
						do_it();
					});
				} else {
					do_it();
				}
			}
			return (handler || _.noop)(ractive.get(keypath + '.err'));
		}
		ractive.set(keypath, _.extend(data, { loaded: true, loading: false }));
		(handler || _.noop)(null, ractive.get(keypath));
	});
};

// TODO Put this in shared pkg
var global_data = {
	_:    _,
	copy: function(name, api) {
		var rest = _.rest(arguments, 2);
		name = (name || '').replace(/\-/g, '_');
		return (!_.isEmpty(api) && chrome.i18n.getMessage(api + '_' + name, rest)) || chrome.i18n.getMessage(name, rest);
	},
	has_media: function(content) {
		return content && (content.video || content.gif || content.images || content.image);
	},
	prefix:    _.prefix,
	timestamp: function(time_in_milli) {
		var time_in_sec = String(Math.floor(time_in_milli / 1000) % 60);
		var time_in_min = String(Math.floor(time_in_milli / (60 * 1000)) % 60);
		while (time_in_sec.length < 2) {
			time_in_sec = '0' + time_in_sec;
		}
		return time_in_min + ':' + time_in_sec;
	},
	url: urls.print
};

var HoverCardRactive = Ractive.extend({
	data:     global_data,
	partials: _.chain(require('../../node_modules/hovercardsshared/*/@(content|discussion|discussion-header|account|account-content).html', { mode: 'hash' }))
		.extend(require('../../node_modules/hovercardsshared/@(content|discussion|discussion-header|account|account-content)/layout.html', { mode: 'hash' }))
		.reduce(function(memo, template, key) {
			memo[key.replace('/', '-')] = template;
			return memo;
		}, {})
		.value(),
	components: _.chain(require('../../node_modules/hovercardsshared/*/*.ract', { mode: 'hash' }))
		.extend(require('../../node_modules/hovercardsshared/common/*.ract', { mode: 'hash' }))
		.reduce(function(memo, obj, key) {
			obj.data = _.extend(obj.data || {}, global_data);
			var key_parts = key.split(/[/-]/g);
			while (key_parts[0] && _.isEqual(key_parts[0], key_parts[1])) {
				key_parts.shift();
			}
			memo[key_parts.join('-')] = Ractive.extend(obj);
			return memo;
		}, {})
		.value(),
	decorators: _.chain(require('../../node_modules/hovercardsshared/common/*-decorator.js', { mode: 'hash' }))
		.reduce(function(memo, template, key) {
			memo[key.replace(/-decorator$/, '')] = template;
			return memo;
		}, {})
		.value()
});

module.exports = function(obj, identity) {
	var ractive = obj.data('ractive');

	if (!ractive) {
		ractive = new HoverCardRactive({
			template: '{{>type+"-layout"}}',
			data:     _.clone(identity),
			el:       obj
		});
		obj.data('ractive', ractive);
		ractive.set('scrollpos', 0);
		ractive.set('scrollposbottom', 21);

		switch (identity.type) {
			case 'content':
				ractive.service('content', identity, function(err, data) {
					if (err) {
						return;
					}
					var discussion_apis = _.result(config.apis[data.api], 'discussion_apis', []);
					var discussions = _.chain(data.discussions)
						.each(_.partial(_.extend, _, { loaded: true }))
						.union(_.map(discussion_apis, function(api) {
							return (api === data.api) ?
								_.defaults({ type: 'discussion', loaded: false }, _.omit(data, 'discussions')) :
								{ api: api, type: 'discussion', for: _.omit(data, 'discussions'), loaded: false };
						}))
						.uniq(_.property('api'))
						.sortBy(function(discussion) {
							return _.indexOf(discussion_apis, discussion.api);
						})
						.value();
					ractive.set('discussions', discussions);
					ractive.set('discussion_i', 0);
					ractive.observe('discussion_i', function(i) {
						ractive.service('discussions.' + i);
					});
					async.detectSeries(
						discussions,
						function(discussion, callback) {
							ractive.service('discussions.' + _.indexOf(discussions, discussion), null, function(err, full_discussion) {
								setTimeout(function() {
									return callback(!err && !_.result(full_discussion, 'uncommentable') && !_.chain(full_discussion).result('comments').isEmpty().value());
								});
							});
						},
						function(discussion) {
							if (!discussion) {
								return;
							}
							ractive.set('discussion_i', _.findIndex(discussions, function(a_discussion) {
								return discussion.api === a_discussion.api;
							}));
						}
					);
				});
				break;
			case 'account':
				ractive.set('accounts', [identity]);
				ractive.set('account_i', 0);
				ractive.observe('account_i', function(i) {
					ractive.service('accounts.' + i, null, function(err, data) {
						if (err) {
							return;
						}
						if (data.content) {
							ractive.set('accounts.' + i + '.content.loaded', true);
						} else {
							ractive.set('accounts.' + i + '.content', _.defaults({ type: 'account_content', loaded: false }, data));
						}
						ractive.observeUntil('expanded', function() {
							ractive.service('accounts.' + i + '.content');
						});
						ractive.set('accounts', _.chain(ractive.get('accounts')) .union(data.accounts) .uniq(_.property('api')) .value());
					});
				});
				break;
			default:
				break;
		}
	}

	return ractive;
};
