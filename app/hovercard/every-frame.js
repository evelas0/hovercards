var $                = require('jquery');
var _                = require('underscore');
var analytics        = require('../analytics');
var config           = require('../config');
var template_loading = require('../template_loading');
var urls             = require('hovercardsshared/urls');
require('../common/mixins');

var HOVERABLE_THINGS = [
	{
		selector: 'a[href]:not(.no-hovercard,.hoverZoomLink,[data-href],[data-expanded-url])',
		get_url:  function(link) {
			return link.attr('href');
		}
	},
	{
		selector: 'a[data-href]:not(.no-hovercard,.hoverZoomLink,[data-expanded-url])',
		get_url:  function(link) {
			return link.data('href');
		}
	},
	{
		selector: 'a[data-expanded-url]:not(.no-hovercard,.hoverZoomLink,[data-href])',
		get_url:  function(link) {
			return link.data('expanded-url');
		}
	},
	{
		selector: 'a[data-full-url]:not(.no-hovercard,.hoverZoomLink,[data-href],[data-expanded-url])',
		get_url:  function(link) {
			return link.data('full-url');
		}
	},
	// FIXME Twitter follow button hack
	{
		selector: 'iframe.twitter-follow-button:not(.no-hovercard)',
		get_url:  function(iframe) {
			var match = iframe.attr('src').match(/[?&]screen_name=([a-zA-Z0-9_]+)(?:&|$)/);
			if (!match || !match[1]) {
				return null;
			}
			return 'https://twitter.com/' + match[1];
		}
	}
];

var EXTENSION_ID           = chrome.i18n.getMessage('@@extension_id');
var PADDING_FROM_EDGES     = 10;
var TIMEOUT_BEFORE_CARD    = 500;
var TIMEOUT_BEFORE_FADEOUT = 100;

var NameSpace = '.' + EXTENSION_ID;

var Blur       = 'blur' + NameSpace;
var Cleanup    = 'cleanup' + NameSpace;
var Click      = 'click' + NameSpace;
var MouseLeave = 'mouseleave' + NameSpace;
var MouseMove  = 'mousemove' + NameSpace + ' mouseenter' + NameSpace;

var current_obj;

var disabled;
// FIXME Maybe move this out into its own "feature"
chrome.storage.sync.get('disabled', function(obj) {
	disabled = obj.disabled || {};

	chrome.storage.onChanged.addListener(function(changes, area_name) {
		if (area_name !== 'sync' || !('disabled' in changes)) {
			return;
		}
		disabled = changes.disabled.newValue;
	});
});
function accept_identity(identity, obj) {
	if (!disabled || (disabled[identity.api] && disabled[identity.api][identity.type]) || !config.apis[identity.api]) {
		return false;
	}
	return identity.api !== document.domain.replace(/\.com$/, '').replace(/^.*\./, '') || (identity.api === 'imgur' && identity.type === 'account' && !obj.is('.account-user-name') && !obj.parents('.options,.user-dropdown').length) || (identity.api === 'instagram' && identity.type === 'account' && !obj.is('.-cx-PRIVATE-Navigation__menuLink') && !obj.parents('.dropdown').length) || (identity.api === 'reddit' && (identity.type === 'account' ? !$('body.res').length && !obj.parents('.tabmenu,.user').length : obj.parents('.usertext-body,.search-result-body').length)) || (identity.api === 'twitter' && identity.type === 'account' && document.domain === 'tweetdeck.twitter.com');
}
function massage_url(url) {
	if (!url) {
		return null;
	}
	if (url === '#') {
		return null;
	}
	if (url.match(/^javascript:.*/)) {
		return null;
	}
	var a = document.createElement('a');
	a.href = url;
	url = a.href;
	a.href = '';
	if (a.remove) {
		a.remove();
	}
	if (url === document.URL + '#') {
		return null;
	}
	return url;
}

function make_hovercard(obj, identity, e) {
	if (!_.isObject(identity)) {
		return;
	}
	var analytics_label = _.analytics_label(identity);
	analytics('send', 'event', 'hovercard displayed', 'link hovered', analytics_label, { nonInteraction: true });
	var hovercard_start = Date.now();
	var hovercard__box = $('<div></div>')
		.addClass(_.prefix('box'))
		.addClass(_.prefix('hovercard__box'));

	var hovercard = $('<div></div>')
		.addClass(_.prefix('hovercard'))
		.data(_.prefix('identity'), identity)
		.append(hovercard__box)
		.appendTo('html');

	template_loading(hovercard__box, identity);

	var obj_offset  = obj.offset();
	var obj_height  = obj.height();
	var window_scrollTop = $(window).scrollTop();
	var space_above = obj_offset.top - window_scrollTop;
	var space_below = window.innerHeight - space_above - obj_height;
	var is_top      = (space_above > space_below);
	var left        = Math.max(PADDING_FROM_EDGES, Math.min($(window).scrollLeft() + window.innerWidth - hovercard__box.width() - PADDING_FROM_EDGES, (e ? e.pageX : obj_offset.left) + 1));
	hovercard
		.toggleClass(_.prefix('hovercard_from_top'), is_top)
		.toggleClass(_.prefix('hovercard_from_bottom'), !is_top);

	var top;
	var times = 0;
	var position_interval;
	function position_hovercard() {
		var new_top;
		if (is_top) {
			new_top = Math.max(window_scrollTop + PADDING_FROM_EDGES + hovercard__box.height(), obj_offset.top);
		} else {
			new_top = Math.max(window_scrollTop + PADDING_FROM_EDGES, Math.min(window_scrollTop + window.innerHeight - hovercard__box.height() - PADDING_FROM_EDGES, obj_offset.top + obj_height));
		}
		if (top === new_top) {
			return;
		}
		top = new_top;
		hovercard.offset({ left: left, top: top });
		times++;
		if (times === 3) {
			clearInterval(position_interval);
			return;
		}
	}
	position_hovercard();
	position_interval = setInterval(position_hovercard, 100);
	setTimeout(function() {
		clearInterval(position_interval);
	}, 2500);

	function kill_it() {
		obj.trigger(Cleanup);
	}
	$(window).on(Blur, kill_it);
	obj
		.one(Click, kill_it)
		.one(Cleanup, function(e, keep_hovercard) {
			if (process.env.NODE_ENV !== 'production' && process.env.STICKYCARDS) {
				return;
			}
			analytics('send', 'timing', 'hovercard', 'showing', Date.now() - hovercard_start, analytics_label);
			clearInterval(position_interval);
			if (keep_hovercard) {
				hovercard__box
					.removeClass(_.prefix('hovercard_from_top'))
					.removeClass(_.prefix('hovercard_from_bottom'));
			} else {
				hovercard.remove();
			}
			$(window).off(Blur, kill_it);
			obj.off(NameSpace);
			current_obj = !current_obj.is(obj) && current_obj;
		});
	var both = obj.add(hovercard__box);
	both.on(MouseLeave, function(e) {
		var to = $(e.toElement);
		if (both.is(to) || both.has(to).length) {
			return;
		}
		var kill_timeout = setTimeout(kill_it, TIMEOUT_BEFORE_FADEOUT);
		both.one(MouseMove, function() {
			clearTimeout(kill_timeout);
		});
	});
}

HOVERABLE_THINGS.forEach(function(hoverable) {
	$('html').on(MouseMove, hoverable.selector, function(e) {
		var obj = $(this);
		var url;
		var identity;
		if (obj.is(current_obj) || obj.has(current_obj).length || obj.parents('.' + _.prefix('hovercard')).length || !(url = massage_url(hoverable.get_url(obj))) || !(identity = urls.parse(url)) || !accept_identity(identity, obj)) {
			return;
		}
		if (current_obj) {
			current_obj.trigger(Cleanup);
		}
		var last_e = e;
		var timeout = setTimeout(function() {
			obj.trigger(Cleanup);
			make_hovercard(obj, identity, last_e);
		}, TIMEOUT_BEFORE_CARD);
		function kill_it() {
			obj.trigger(Cleanup);
			if (current_obj) {
				current_obj = !current_obj.is(obj) && current_obj;
			}
		}
		$(window).on(Blur, kill_it);
		current_obj = obj
			.one(MouseLeave, kill_it)
			.one(Cleanup, function() {
				$(window).off(Blur, kill_it);
				obj.off(NameSpace);
				clearTimeout(timeout);
				timeout = null;
			})
			.on(MouseMove, function(e) {
				last_e = e;
			});
	});
});
