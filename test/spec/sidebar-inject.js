'use strict';

describe('sidebar-inject', function() {
    var sandbox = sinon.sandbox.create();
    var body;
    var sidebarObj;

    beforeEach(function(done) {
        require(['sidebar-inject'], function(sidebarInject) {
            sandbox.useFakeTimers();
            sandbox.stub(chrome.runtime.onMessage, 'addListener');
            body = $('<div id="sandbox"></div>');
            sidebarObj = sidebarInject(body);
            done();
        });
    });

    afterEach(function() {
        sandbox.restore();
        body.remove();
    });

    it('should be hidden', function() {
        expect(sidebarObj).to.have.css('display', 'none');
    });

    it('should contain an iframe with correct src', function() {
        expect(sidebarObj.children('iframe')).to.have.prop('src', 'chrome-extension://extension_id/sidebar.html');
    });

    it('should give body overflow:hidden on iframe:mouseenter', function() {
        sidebarObj.children('iframe').mouseenter();
        expect(body).to.have.css('overflow', 'hidden');
    });

    it('should remove body overflow:hidden on iframe:mouseleave', function() {
        body.css('overflow', 'hidden');
        sidebarObj.children('iframe').mouseleave();
        expect(body).to.not.have.css('overflow', 'hidden');
    });

    describe('on load/show/hide', function() {
        it('should be visible on load', function() {
            chrome.runtime.onMessage.addListener.yield({ msg: 'load', content: 'something', id: 'SOME_ID' });
            expect(sidebarObj).to.not.have.css('display', 'none');
        });

        it('should be hidden on hide', function() {
            chrome.runtime.onMessage.addListener.yield({ msg: 'hide' });
            expect(sidebarObj).to.have.css('display', 'none');
        });
    });
});
