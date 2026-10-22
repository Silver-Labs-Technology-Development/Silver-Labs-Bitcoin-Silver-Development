#ifndef BITCOINSILVER_QT_SILVERFORGEPAGE_H
#define BITCOINSILVER_QT_SILVERFORGEPAGE_H

#include <QWidget>

class WalletModel;
class PlatformStyle;

namespace Ui {
    class SilverForgePage;
}

class SilverForgePage : public QWidget
{
    Q_OBJECT

public:
    explicit SilverForgePage(const PlatformStyle *platformStyle, QWidget *parent = nullptr);
    ~SilverForgePage();

    void setModel(WalletModel *model);

private:
    Ui::SilverForgePage *ui;
    WalletModel *model;
    const PlatformStyle *platformStyle;

private Q_SLOTS:
    void updateL2Status();
};

#endif // BITCOINSILVER_QT_SILVERFORGEPAGE_H
