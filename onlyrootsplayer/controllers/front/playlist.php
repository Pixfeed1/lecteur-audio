<?php
/**
 * API controller — returns audio tracks for products in JSON.
 *
 * Two actions:
 *   - default (id_product=N) : full playlist for one product
 *   - action=batch (ids=1,2,3) : list of product IDs that have audio,
 *     used by the front to decide which cards get a play button.
 *
 * @author    PixFeed - Marc Gueffie
 * @copyright 2026 PixFeed
 */

class OnlyrootsplayerPlaylistModuleFrontController extends ModuleFrontController
{
    /** @var bool we render JSON ourselves, skip the theme rendering */
    public $ajax = true;

    public function initContent()
    {
        parent::initContent();
        $this->handleRequest();
    }

    public function display()
    {
        $this->handleRequest();
    }

    private function handleRequest()
    {
        $action = Tools::getValue('action');

        if ($action === 'batch') {
            $this->handleBatch();
            return;
        }

        $this->handleSingle();
    }

    private function handleSingle()
    {
        $idProduct = (int) Tools::getValue('id_product');
        if ($idProduct <= 0) {
            $this->ajaxResponse(['error' => 'Missing or invalid id_product'], 400);
            return;
        }

        if (!OnlyRootsPlayer::audioSourceAvailable()) {
            $this->ajaxResponse(['error' => 'Audio source unavailable'], 503);
            return;
        }

        $idLang = (int) $this->context->language->id;
        $idShop = (int) $this->context->shop->id;

        $product = new Product($idProduct, false, $idLang, $idShop);
        if (!Validate::isLoadedObject($product) || !$product->active) {
            $this->ajaxResponse(['error' => 'Product not found'], 404);
            return;
        }

        $tracks = OnlyRootsPlayer::getProductTracks($idProduct);
        if (empty($tracks)) {
            $this->ajaxResponse(['error' => 'No tracks found'], 404);
            return;
        }

        // Cover image
        $imageUrl = '';
        $cover = Product::getCover($idProduct);
        if ($cover) {
            $linkRewrite = is_array($product->link_rewrite)
                ? ($product->link_rewrite[$idLang] ?? reset($product->link_rewrite))
                : $product->link_rewrite;

            $imageUrl = $this->context->link->getImageLink(
                $linkRewrite,
                (int) $cover['id_image'],
                'small_default'
            );
        }

        $productName = is_array($product->name)
            ? ($product->name[$idLang] ?? reset($product->name))
            : $product->name;

        $this->ajaxResponse([
            'id_product' => $idProduct,
            'name'       => (string) $productName,
            'image'      => (string) $imageUrl,
            'url'        => (string) $this->context->link->getProductLink($idProduct),
            'tracks'     => $tracks,
        ]);
    }

    /**
     * Returns the subset of input product IDs that have at least one audio
     * track. Used by the front to inject play buttons only where relevant.
     */
    private function handleBatch()
    {
        if (!OnlyRootsPlayer::audioSourceAvailable()) {
            $this->ajaxResponse(['products' => []]);
            return;
        }

        $rawIds = (string) Tools::getValue('ids', '');
        if ($rawIds === '') {
            $this->ajaxResponse(['products' => []]);
            return;
        }

        $productIds = array_filter(
            array_map('intval', explode(',', $rawIds)),
            function ($v) { return $v > 0; }
        );

        if (empty($productIds)) {
            $this->ajaxResponse(['products' => []]);
            return;
        }

        $withAudio = OnlyRootsPlayer::getProductsWithAudio($productIds);
        $this->ajaxResponse(['products' => $withAudio]);
    }

    private function ajaxResponse($data, $httpCode = 200)
    {
        http_response_code($httpCode);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Robots-Tag: noindex, nofollow');
        if ($httpCode === 200) {
            header('Cache-Control: public, max-age=60');
        } else {
            header('Cache-Control: no-store');
        }
        echo json_encode($data);
        exit;
    }
}
